import { operationName, type QueryRequest } from '../shared/urql-client';
import type { PriceOrder, PriceRows, PriceState } from '../shared/price-signal';
import type { MutationResult } from './client-hooks';
import { isGridVariables, type Variables } from './list-families';
import { DEFAULT_CONNECTION_TYPE, DEFAULT_PAGE_INFO_TYPE, modifierOf, slugOf, type CrawledList, type Row } from './price-crawl';
import {
  createPrivateCursor,
  hasPrivateCursor,
  isPrivateVariables,
  privateFieldOf,
  privateVariablesOf,
  readCursor,
  realVariablesOf,
  variableNamesOf,
  viewKeyOf,
} from './price-private';

const LOCK_MUTATION = 'bulkUpdateUserCardLock';
const ACCEPTING_MUTATIONS = ['acceptCardTrade', 'acceptCardOffer'];
const REBUILDING_MUTATIONS = ['forgeCards', 'restoreForge', 'openCardPack', 'claimCardDrop'];
const FLAGGED_MUTATIONS = [...ACCEPTING_MUTATIONS, LOCK_MUTATION];

export interface ListPage {
  request: QueryRequest;
  options: Record<string, unknown>;
}

export interface ViewList extends CrawledList {
  pageSize: number;
}

export interface ViewHost {
  isReady: () => boolean;
  crawl: (page: ListPage, report: (loaded: number, total: number | null) => void, signal: AbortSignal) => Promise<ViewList | null>;
  redrive: (page: ListPage, variables: Variables) => void;
  refreshPage: (page: ListPage, variables: Variables) => void;
  publishState: (state: PriceState) => void;
  publishRows: (rows: PriceRows) => void;
  debug: (...details: unknown[]) => void;
}

export interface PageAnswer {
  data: {
    userCards: {
      __typename: string;
      edges: Row[];
      pageInfo: { __typename: string; hasNextPage: boolean; endCursor: string | null };
    };
  };
}

export interface PriceView {
  watch: (request: QueryRequest, options: Record<string, unknown> | undefined) => void;
  rewrite: (request: QueryRequest) => QueryRequest;
  answer: (variables: Variables) => PageAnswer;
  start: () => void;
  stop: () => void;
  receiveOrder: (order: PriceOrder) => void;
  handleMutation: (mutation: MutationResult) => void;
}

interface Orders {
  descending: number[];
  ascending: number[];
}

interface View {
  id: number;
  key: string;
  names: string;
  userId: unknown;
  orderField: unknown;
  phase: 'crawling' | 'sorting' | 'ready';
  rows: Row[];
  pageSize: number;
  connectionType: string;
  pageInfoType: string;
  orders: Orders | null;
  revision: number;
  version: number;
  servedPages: Set<string>;
  controller: AbortController;
}

interface LockInput {
  userId?: unknown;
  locked?: unknown;
  cards?: { cardId?: unknown; modifier?: unknown }[];
}

const UNAVAILABLE: PriceState = { name: 'unavailable', loaded: 0, total: null };
const FAILED: PriceState = { name: 'failed', loaded: 0, total: null };

const variablesOf = (page: ListPage): Variables => page.request.variables ?? {};

const emptyAnswer = (): PageAnswer => ({
  data: {
    userCards: {
      __typename: DEFAULT_CONNECTION_TYPE,
      edges: [],
      pageInfo: { __typename: DEFAULT_PAGE_INFO_TYPE, hasNextPage: false, endCursor: null },
    },
  },
});

function isPermutation(order: number[], size: number): boolean {
  if (order.length !== size) return false;
  const seen = new Set<number>();
  return order.every((index) => {
    const isNew = index < size && !seen.has(index);
    seen.add(index);
    return isNew;
  });
}

const pageKeyOf = (direction: string, offset: number): string => `${direction}:${offset}`;

const directionOf = (variables: Variables): 'ASC' | 'DESC' => (variables.orderDirection === 'ASC' ? 'ASC' : 'DESC');

const readLockInput = (mutation: MutationResult): LockInput | null => {
  const input = mutation.operation?.variables?.input;
  return input && typeof input === 'object' ? input : null;
};

function isSuccessful(mutation: MutationResult, name: string): boolean {
  if (mutation.error || !mutation.data) return false;
  const payload = mutation.data[name] as { success?: unknown } | null | undefined;
  return FLAGGED_MUTATIONS.includes(name) ? payload?.success === true : Boolean(payload);
}

interface ViewState {
  host: ViewHost;
  isOn: boolean;
  latest: ListPage | null;
  current: ListPage | null;
  view: View | null;
  lastId: number;
  lastVersion: number;
}

const isServing = (state: ViewState): boolean => state.isOn && state.view?.phase === 'ready';

const redriveReal = (state: ViewState, page: ListPage): void => state.host.redrive(page, realVariablesOf(variablesOf(page)));

function fail(state: ViewState, failed: View, priceState: PriceState): void {
  if (state.view !== failed) return;
  state.view = null;
  state.host.publishState(priceState);
}

function arrive(state: ViewState, arrived: View, list: ViewList | null): void {
  if (state.view !== arrived) return;
  if (!list) return fail(state, arrived, UNAVAILABLE);
  if (list.rows.length === 0) return fail(state, arrived, FAILED);
  arrived.rows = list.rows;
  arrived.pageSize = list.pageSize;
  arrived.connectionType = list.connectionType;
  arrived.pageInfoType = list.pageInfoType;
  arrived.phase = 'sorting';
  state.host.debug('price view rows', { viewId: arrived.id, rows: list.rows.length });
  state.host.publishRows({ viewId: arrived.id, slugs: list.rows.map(slugOf) });
}

function createView(id: number, variables: Variables): View {
  return {
    id,
    key: viewKeyOf(variables),
    names: variableNamesOf(variables),
    userId: variables.userId,
    orderField: variables.orderField,
    phase: 'crawling',
    rows: [],
    pageSize: 0,
    connectionType: DEFAULT_CONNECTION_TYPE,
    pageInfoType: DEFAULT_PAGE_INFO_TYPE,
    orders: null,
    revision: 0,
    version: 0,
    servedPages: new Set(),
    controller: new AbortController(),
  };
}

function begin(state: ViewState, page: ListPage): void {
  const { host } = state;
  state.view?.controller.abort();
  state.lastId += 1;
  const started = createView(state.lastId, variablesOf(page));
  state.view = started;
  state.current = page;
  host.debug('price view begins', { viewId: started.id });
  host.publishState({ name: 'loading', loaded: 0, total: null });
  const report = (loaded: number, total: number | null): void => {
    if (state.view === started) host.publishState({ name: 'loading', loaded, total });
  };
  host.crawl(page, report, started.controller.signal).then(
    (list) => arrive(state, started, list),
    () => fail(state, started, FAILED)
  );
}

function invalidate(state: ViewState): void {
  if (!state.isOn || !state.view || !state.current) return;
  const page = state.current;
  const wasServing = isServing(state);
  state.host.debug('price view invalidated');
  begin(state, page);
  if (wasServing) redriveReal(state, page);
}

function patchLocks(view: View | null, input: LockInput): Set<number> {
  const patched = new Set<number>();
  const cards = input.cards;
  if (!view || input.userId !== view.userId || !Array.isArray(cards) || typeof input.locked !== 'boolean') return patched;
  view.rows.forEach((row, index) => {
    if (!cards.some((card) => card.cardId === row.node.card?.id && modifierOf(card.modifier) === modifierOf(row.node.modifier))) return;
    row.node.locked = input.locked;
    patched.add(index);
  });
  return patched;
}

function holdsRow(view: View, pageKey: string, index: number): boolean {
  const [direction, offset] = pageKey.split(':');
  const orders = view.orders;
  if (!orders) return false;
  const order = direction === 'ASC' ? orders.ascending : orders.descending;
  return order.slice(Number(offset), Number(offset) + view.pageSize).includes(index);
}

function refreshServed(state: ViewState, patched: Set<number>): void {
  const { view, current } = state;
  if (!view || !current) return;
  const pageKeys = new Set<string>();
  for (const index of patched) {
    const holder = [...view.servedPages].find((pageKey) => holdsRow(view, pageKey, index));
    if (holder) pageKeys.add(holder);
  }
  for (const pageKey of pageKeys) {
    const [direction, offset] = pageKey.split(':');
    const after = Number(offset) === 0 ? null : createPrivateCursor(view.version, Number(offset));
    state.host.refreshPage(current, privateVariablesOf({ ...variablesOf(current), orderDirection: direction, after }, view.version));
  }
}

function followList(state: ViewState, page: ListPage, variables: Variables): void {
  const view = state.view;
  if (!state.isOn || !view) return;
  if (viewKeyOf(variables) === view.key) state.current = page;
  else if (variableNamesOf(variables) === view.names && variables.userId === view.userId) begin(state, page);
}

function watchList(state: ViewState, request: QueryRequest, options: Record<string, unknown> | undefined): void {
  const variables = request.variables;
  if (!variables || isPrivateVariables(variables)) return;
  const page: ListPage = { request, options: options ?? {} };
  if (isGridVariables(variables)) state.latest = page;
  followList(state, page, variables);
}

function rewriteList(state: ViewState, request: QueryRequest): QueryRequest {
  const variables = request.variables;
  if (!variables || isPrivateVariables(variables)) return request;
  const view = state.view;
  if (isServing(state) && view && viewKeyOf(variables) === view.key) return { ...request, variables: privateVariablesOf(variables, view.version) };
  return hasPrivateCursor(variables.after) ? { ...request, variables: realVariablesOf(variables) } : request;
}

function isServedList(view: View | null, variables: Variables): view is View & { orders: Orders } {
  return (
    view?.phase === 'ready' &&
    view.orders !== null &&
    variables.orderField === privateFieldOf(view.version) &&
    viewKeyOf({ ...variables, orderField: view.orderField }) === view.key
  );
}

function answerPage(state: ViewState, variables: Variables): PageAnswer {
  const served = state.view;
  if (!isServedList(served, variables)) return emptyAnswer();
  const cursor = readCursor(variables.after);
  const offset = cursor?.version === served.version ? cursor.offset : 0;
  const direction = directionOf(variables);
  served.servedPages.add(pageKeyOf(direction, offset));
  const order = direction === 'ASC' ? served.orders.ascending : served.orders.descending;
  const edges = order.slice(offset, offset + served.pageSize).flatMap((index) => served.rows[index] ?? []);
  const end = offset + edges.length;
  const hasNextPage = end < order.length;
  return {
    data: {
      userCards: {
        __typename: served.connectionType,
        edges,
        pageInfo: { __typename: served.pageInfoType, hasNextPage, endCursor: hasNextPage ? createPrivateCursor(served.version, end) : null },
      },
    },
  };
}

function startView(state: ViewState): void {
  state.isOn = true;
  const isReady = state.host.isReady();
  state.host.debug('price view start', { isReady, hasList: state.latest !== null });
  if (!isReady || !state.latest) return state.host.publishState(UNAVAILABLE);
  begin(state, state.latest);
}

function stopView(state: ViewState): void {
  const page = state.current;
  const wasServing = isServing(state);
  state.isOn = false;
  state.view?.controller.abort();
  state.view = null;
  state.current = null;
  state.host.debug('price view stops');
  if (wasServing && page) redriveReal(state, page);
}

const acceptsOrder = (view: View | null, order: PriceOrder): view is View =>
  view !== null &&
  view.id === order.viewId &&
  view.phase !== 'crawling' &&
  order.revision > view.revision &&
  isPermutation(order.descending, view.rows.length) &&
  isPermutation(order.ascending, view.rows.length);

function receiveOrder(state: ViewState, order: PriceOrder): void {
  const view = state.view;
  if (!acceptsOrder(view, order)) return;
  view.orders = { descending: order.descending, ascending: order.ascending };
  view.revision = order.revision;
  state.lastVersion += 1;
  view.version = state.lastVersion;
  view.servedPages = new Set();
  view.phase = 'ready';
  state.host.debug('price view ready', { viewId: view.id, version: view.version });
  state.host.publishState({ name: 'ready', loaded: view.rows.length, total: view.rows.length });
  if (state.current) state.host.redrive(state.current, privateVariablesOf(variablesOf(state.current), view.version));
}

function handleLockMutation(state: ViewState, view: View, mutation: MutationResult): void {
  const input = readLockInput(mutation);
  if (view.phase === 'crawling') invalidate(state);
  else if (input) refreshServed(state, patchLocks(view, input));
}

function handleViewMutation(state: ViewState, mutation: MutationResult): void {
  const name = mutation.operation ? operationName(mutation.operation) : undefined;
  const view = state.view;
  if (!state.isOn || !view || !name || !isSuccessful(mutation, name)) return;
  if (name === LOCK_MUTATION) handleLockMutation(state, view, mutation);
  else if (ACCEPTING_MUTATIONS.includes(name) || REBUILDING_MUTATIONS.includes(name)) invalidate(state);
}

export function createPriceView(host: ViewHost): PriceView {
  const state: ViewState = { host, isOn: false, latest: null, current: null, view: null, lastId: 0, lastVersion: 0 };
  return {
    watch: (request, options) => watchList(state, request, options),
    rewrite: (request) => rewriteList(state, request),
    answer: (variables) => answerPage(state, variables),
    start: () => startView(state),
    stop: () => stopView(state),
    receiveOrder: (order) => receiveOrder(state, order),
    handleMutation: (mutation) => handleViewMutation(state, mutation),
  };
}
