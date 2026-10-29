import { getOperationName, makeOperation, type Operation, type OperationResult } from '@urql/core';

import type { ListScope } from '../shared/list-scope';
import type { PriceOrder, PriceRows, PriceState } from '../shared/price-signal';
import { listScopeOf, type Variables } from './list-families';
import { DEFAULT_CONNECTION_TYPE, DEFAULT_PAGE_INFO_TYPE, modifierOf, slugOf, type CrawledList, type Row } from './price-crawl';
import { createPrivateCursor, hasPrivateCursor, readCursor, realVariablesOf, variableNamesOf, viewKeyOf } from './price-private';

const LOCK_MUTATION = 'bulkUpdateUserCardLock';
const ACCEPTING_MUTATIONS = ['acceptCardTrade', 'acceptCardOffer'];
const REBUILDING_MUTATIONS = ['forgeCards', 'restoreForge', 'openCardPack', 'claimCardDrop'];
const FLAGGED_MUTATIONS = [...ACCEPTING_MUTATIONS, LOCK_MUTATION];

export interface ViewList extends CrawledList {
  pageSize: number;
}

export interface ViewHost {
  isReady: () => boolean;
  crawl: (operation: Operation, report: (loaded: number, total: number | null) => void, signal: AbortSignal) => Promise<ViewList | null>;
  redrive: (operation: Operation) => void;
  publishState: (state: PriceState) => void;
  publishRows: (rows: PriceRows) => void;
  debug: (...details: unknown[]) => void;
}

export interface PageAnswer {
  userCards: {
    __typename: string;
    edges: Row[];
    pageInfo: { __typename: string; hasNextPage: boolean; endCursor: string | null };
  };
}

export interface PriceView {
  watch: (operation: Operation) => void;
  answer: (operation: Operation) => PageAnswer | null;
  forwarded: (operation: Operation) => Operation;
  start: () => void;
  stop: () => void;
  restart: () => void;
  receiveOrder: (order: PriceOrder) => void;
  handleMutation: (result: OperationResult) => void;
}

export interface ViewCounters {
  lastId: number;
  lastVersion: number;
}

export interface ViewOptions {
  scope: ListScope;
  counters: ViewCounters;
}

export const createViewCounters = (): ViewCounters => ({ lastId: 0, lastVersion: 0 });

interface Orders {
  descending: number[];
  ascending: number[];
}

interface View {
  id: number;
  key: string;
  names: string;
  userId: unknown;
  crawled: Variables;
  phase: 'crawling' | 'sorting' | 'ready';
  rows: Row[];
  pageSize: number;
  connectionType: string;
  pageInfoType: string;
  orders: Orders | null;
  revision: number;
  version: number;
  controller: AbortController;
}

type ServedView = View & { orders: Orders };

interface LockInput {
  userId?: unknown;
  locked?: unknown;
  cards?: { cardId?: unknown; modifier?: unknown }[];
}

const UNAVAILABLE: PriceState = { name: 'unavailable', loaded: 0, total: null };
const FAILED: PriceState = { name: 'failed', loaded: 0, total: null };

const variablesOf = (operation: Operation): Variables => operation.variables ?? {};

const withVariables = (operation: Operation, variables: Variables): Operation => makeOperation(operation.kind, { ...operation, variables }, operation.context);

function isPermutation(order: number[], size: number): boolean {
  if (order.length !== size) return false;
  const seen = new Set<number>();
  return order.every((index) => {
    const isNew = index < size && !seen.has(index);
    seen.add(index);
    return isNew;
  });
}

const directionOf = (variables: Variables): 'ASC' | 'DESC' => (variables.orderDirection === 'ASC' ? 'ASC' : 'DESC');

const readLockInput = (result: OperationResult): LockInput | null => {
  const input = (result.operation.variables as { input?: unknown } | undefined)?.input;
  return input && typeof input === 'object' ? input : null;
};

function isSuccessful(result: OperationResult, name: string): boolean {
  const data = result.data as Record<string, unknown> | null | undefined;
  if (result.error || !data) return false;
  const payload = data[name] as { success?: unknown } | null | undefined;
  return FLAGGED_MUTATIONS.includes(name) ? payload?.success === true : Boolean(payload);
}

interface ViewState {
  host: ViewHost;
  scope: ListScope;
  counters: ViewCounters;
  isOn: boolean;
  latest: Operation | null;
  current: Operation | null;
  view: View | null;
}

const isServing = (state: ViewState): boolean => state.isOn && state.view?.phase === 'ready';

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

function createView(id: number, variables: Variables, crawled: Variables): View {
  return {
    id,
    key: viewKeyOf(variables),
    names: variableNamesOf(variables),
    userId: variables.userId,
    crawled,
    phase: 'crawling',
    rows: [],
    pageSize: 0,
    connectionType: DEFAULT_CONNECTION_TYPE,
    pageInfoType: DEFAULT_PAGE_INFO_TYPE,
    orders: null,
    revision: 0,
    version: 0,
    controller: new AbortController(),
  };
}

function begin(state: ViewState, operation: Operation, crawled: Variables = variablesOf(operation)): void {
  const { host } = state;
  state.view?.controller.abort();
  state.counters.lastId += 1;
  const started = createView(state.counters.lastId, variablesOf(operation), crawled);
  state.view = started;
  state.current = operation;
  host.debug('price view begins', { viewId: started.id });
  host.publishState({ name: 'loading', loaded: 0, total: null });
  const report = (loaded: number, total: number | null): void => {
    if (state.view === started) host.publishState({ name: 'loading', loaded, total });
  };
  host.crawl(withVariables(operation, crawled), report, started.controller.signal).then(
    (list) => arrive(state, started, list),
    () => fail(state, started, FAILED)
  );
}

function invalidate(state: ViewState): void {
  if (!state.isOn || !state.view || !state.current) return;
  const operation = state.current;
  const wasServing = isServing(state);
  state.host.debug('price view invalidated');
  begin(state, operation, state.view.crawled);
  if (wasServing) state.host.redrive(operation);
}

function patchLocks(view: View, input: LockInput): boolean {
  const cards = input.cards;
  if (input.userId !== view.userId || !Array.isArray(cards) || typeof input.locked !== 'boolean') return false;
  let didPatch = false;
  for (const row of view.rows) {
    if (!cards.some((card) => card.cardId === row.node.card?.id && modifierOf(card.modifier) === modifierOf(row.node.modifier))) continue;
    row.node.locked = input.locked;
    didPatch = true;
  }
  return didPatch;
}

const canFollowOtherUsers = (scope: ListScope): boolean => scope === 'picker';

function followList(state: ViewState, operation: Operation, variables: Variables): void {
  const view = state.view;
  if (!state.isOn || !view) return;
  if (viewKeyOf(variables) === view.key) state.current = operation;
  else if (variableNamesOf(variables) === view.names && (canFollowOtherUsers(state.scope) || variables.userId === view.userId)) begin(state, operation);
}

const isOwnList = (state: ViewState, variables: Variables): boolean => listScopeOf(variables) === state.scope;

function watchList(state: ViewState, operation: Operation): void {
  const variables = variablesOf(operation);
  if (!isOwnList(state, variables)) return;
  state.latest = operation;
  followList(state, operation, variables);
}

function servedViewOf(state: ViewState, variables: Variables): ServedView | null {
  const view = state.view;
  if (!isServing(state) || !view?.orders || !isOwnList(state, variables) || viewKeyOf(variables) !== view.key) return null;
  return view as ServedView;
}

function answerList(state: ViewState, operation: Operation): PageAnswer | null {
  const variables = variablesOf(operation);
  const served = servedViewOf(state, variables);
  if (!served) return null;
  const cursor = readCursor(variables.after);
  const offset = cursor?.version === served.version ? cursor.offset : 0;
  const order = directionOf(variables) === 'ASC' ? served.orders.ascending : served.orders.descending;
  const end = Math.min(order.length, offset + served.pageSize);
  const hasNextPage = end < order.length;
  return {
    userCards: {
      __typename: served.connectionType,
      edges: order.slice(0, end).flatMap((index) => served.rows[index] ?? []),
      pageInfo: { __typename: served.pageInfoType, hasNextPage, endCursor: hasNextPage ? createPrivateCursor(served.version, end) : null },
    },
  };
}

function forwardedList(state: ViewState, operation: Operation): Operation {
  const variables = variablesOf(operation);
  return isOwnList(state, variables) && hasPrivateCursor(variables.after) ? withVariables(operation, realVariablesOf(variables)) : operation;
}

function startView(state: ViewState): void {
  state.isOn = true;
  const isReady = state.host.isReady();
  state.host.debug('price view start', { isReady, hasList: state.latest !== null });
  if (!isReady || !state.latest) return state.host.publishState(UNAVAILABLE);
  begin(state, state.latest);
}

function stopView(state: ViewState): void {
  const operation = state.current;
  const wasServing = isServing(state);
  state.isOn = false;
  state.view?.controller.abort();
  state.view = null;
  state.current = null;
  state.host.debug('price view stops');
  if (wasServing && operation) state.host.redrive(operation);
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
  state.counters.lastVersion += 1;
  view.version = state.counters.lastVersion;
  view.phase = 'ready';
  state.host.debug('price view ready', { viewId: view.id, version: view.version });
  state.host.publishState({ name: 'ready', loaded: view.rows.length, total: view.rows.length });
  if (state.current) state.host.redrive(state.current);
}

function handleLockMutation(state: ViewState, view: View, result: OperationResult): void {
  if (view.phase === 'crawling') return invalidate(state);
  const input = readLockInput(result);
  if (input && patchLocks(view, input) && isServing(state) && state.current) state.host.redrive(state.current);
}

function handleViewMutation(state: ViewState, result: OperationResult): void {
  const name = getOperationName(result.operation.query);
  const view = state.view;
  if (!state.isOn || !view || !name || !isSuccessful(result, name)) return;
  if (name === LOCK_MUTATION) handleLockMutation(state, view, result);
  else if (ACCEPTING_MUTATIONS.includes(name) || REBUILDING_MUTATIONS.includes(name)) invalidate(state);
}

export function createPriceView(host: ViewHost, { scope, counters }: ViewOptions): PriceView {
  const state: ViewState = { host, scope, counters, isOn: false, latest: null, current: null, view: null };
  return {
    watch: (operation) => watchList(state, operation),
    answer: (operation) => answerList(state, operation),
    forwarded: (operation) => forwardedList(state, operation),
    start: () => startView(state),
    stop: () => stopView(state),
    restart: () => invalidate(state),
    receiveOrder: (order) => receiveOrder(state, order),
    handleMutation: (result) => handleViewMutation(state, result),
  };
}
