import { operationName, type QueryRequest } from '../shared/urql-client';
import type { PriceOrder, PriceRows, PriceState } from '../shared/price-signal';
import type { MutationResult } from './client-hooks';
import { isGridVariables, type Variables } from './list-families';
import { modifierOf, slugOf, type CrawledList, type Row } from './price-crawl';
import {
  cursorOf,
  hasPrivateCursor,
  isPrivateVariables,
  privateFieldOf,
  privateVariablesOf,
  readCursor,
  realVariablesOf,
  variableNamesOf,
  viewKeyOf,
} from './price-private';

const DEFAULT_CONNECTION_TYPE = 'UserCardConnection';
const DEFAULT_PAGE_INFO_TYPE = 'PageInfo';
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

export function createPriceView(host: ViewHost): PriceView {
  let isOn = false;
  let latest: ListPage | null = null;
  let current: ListPage | null = null;
  let view: View | null = null;
  let lastId = 0;
  let lastVersion = 0;

  const isServing = (): boolean => isOn && view?.phase === 'ready';

  const redriveReal = (page: ListPage): void => host.redrive(page, realVariablesOf(variablesOf(page)));

  function fail(failed: View, state: PriceState): void {
    if (view !== failed) return;
    view = null;
    host.publishState(state);
  }

  function arrive(arrived: View, list: ViewList | null): void {
    if (view !== arrived) return;
    if (!list) return fail(arrived, UNAVAILABLE);
    if (list.rows.length === 0) return fail(arrived, FAILED);
    arrived.rows = list.rows;
    arrived.pageSize = list.pageSize;
    arrived.connectionType = list.connectionType;
    arrived.pageInfoType = list.pageInfoType;
    arrived.phase = 'sorting';
    host.debug('price view rows', { viewId: arrived.id, rows: list.rows.length });
    host.publishRows({ viewId: arrived.id, slugs: list.rows.map(slugOf) });
  }

  function begin(page: ListPage): void {
    view?.controller.abort();
    const variables = variablesOf(page);
    lastId += 1;
    const started: View = {
      id: lastId,
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
    view = started;
    current = page;
    host.debug('price view begins', { viewId: started.id });
    host.publishState({ name: 'loading', loaded: 0, total: null });
    const report = (loaded: number, total: number | null): void => {
      if (view === started) host.publishState({ name: 'loading', loaded, total });
    };
    host.crawl(page, report, started.controller.signal).then(
      (list) => arrive(started, list),
      () => fail(started, FAILED)
    );
  }

  function invalidate(): void {
    if (!isOn || !view || !current) return;
    const page = current;
    const wasServing = isServing();
    host.debug('price view invalidated');
    begin(page);
    if (wasServing) redriveReal(page);
  }

  function patchLocks(input: LockInput): Set<number> {
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

  function holdsRow(pageKey: string, index: number): boolean {
    const [direction, offset] = pageKey.split(':');
    const orders = view?.orders;
    if (!view || !orders) return false;
    const order = direction === 'ASC' ? orders.ascending : orders.descending;
    return order.slice(Number(offset), Number(offset) + view.pageSize).includes(index);
  }

  function refreshServed(patched: Set<number>): void {
    if (!view || !current) return;
    const pageKeys = new Set<string>();
    for (const index of patched) {
      const holder = [...view.servedPages].find((pageKey) => holdsRow(pageKey, index));
      if (holder) pageKeys.add(holder);
    }
    for (const pageKey of pageKeys) {
      const [direction, offset] = pageKey.split(':');
      const after = Number(offset) === 0 ? null : cursorOf(view.version, Number(offset));
      host.refreshPage(current, privateVariablesOf({ ...variablesOf(current), orderDirection: direction, after }, view.version));
    }
  }

  return {
    watch(request, options) {
      const variables = request.variables;
      if (!variables || isPrivateVariables(variables)) return;
      const page: ListPage = { request, options: options ?? {} };
      if (isGridVariables(variables)) latest = page;
      if (!isOn || !view) return;
      if (viewKeyOf(variables) === view.key) current = page;
      else if (variableNamesOf(variables) === view.names && variables.userId === view.userId) begin(page);
    },

    rewrite(request) {
      const variables = request.variables;
      if (!variables || isPrivateVariables(variables)) return request;
      if (isServing() && view && viewKeyOf(variables) === view.key) return { ...request, variables: privateVariablesOf(variables, view.version) };
      return hasPrivateCursor(variables.after) ? { ...request, variables: realVariablesOf(variables) } : request;
    },

    answer(variables) {
      const served = view?.phase === 'ready' ? view : null;
      if (
        !served?.orders ||
        variables.orderField !== privateFieldOf(served.version) ||
        viewKeyOf({ ...variables, orderField: served.orderField }) !== served.key
      ) {
        return emptyAnswer();
      }
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
            pageInfo: { __typename: served.pageInfoType, hasNextPage, endCursor: hasNextPage ? cursorOf(served.version, end) : null },
          },
        },
      };
    },

    start() {
      isOn = true;
      const isReady = host.isReady();
      host.debug('price view start', { isReady, hasList: latest !== null });
      if (!isReady || !latest) return host.publishState(UNAVAILABLE);
      begin(latest);
    },

    stop() {
      const page = current;
      const wasServing = isServing();
      isOn = false;
      view?.controller.abort();
      view = null;
      current = null;
      host.debug('price view stops');
      if (wasServing && page) redriveReal(page);
    },

    receiveOrder(order) {
      if (!view || view.id !== order.viewId || view.phase === 'crawling' || order.revision <= view.revision) return;
      if (!isPermutation(order.descending, view.rows.length) || !isPermutation(order.ascending, view.rows.length)) return;
      view.orders = { descending: order.descending, ascending: order.ascending };
      view.revision = order.revision;
      lastVersion += 1;
      view.version = lastVersion;
      view.servedPages = new Set();
      view.phase = 'ready';
      host.debug('price view ready', { viewId: view.id, version: view.version });
      host.publishState({ name: 'ready', loaded: view.rows.length, total: view.rows.length });
      if (current) host.redrive(current, privateVariablesOf(variablesOf(current), view.version));
    },

    handleMutation(mutation) {
      const name = mutation.operation ? operationName(mutation.operation) : undefined;
      if (!isOn || !view || !name || !isSuccessful(mutation, name)) return;
      if (name === LOCK_MUTATION) {
        const input = readLockInput(mutation);
        if (view.phase === 'crawling') invalidate();
        else if (input) refreshServed(patchLocks(input));
      } else if (ACCEPTING_MUTATIONS.includes(name) || REBUILDING_MUTATIONS.includes(name)) invalidate();
    },
  };
}
