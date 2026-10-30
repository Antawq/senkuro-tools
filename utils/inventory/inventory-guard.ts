import { getOperationName, makeOperation, type Client, type Exchange, type Operation, type OperationContext, type OperationResult } from '@urql/core';

import { debugLogger } from '../shared/debug';
import type { Transport } from '../shared/graphql';
import type { PageWindow } from '../shared/page-window';
import { priceOrderSignal, priceRowsSignal, priceStateSignal, priceViewSignal } from '../shared/price-signal';
import { GUARD_ATTRIBUTE, GUARD_READY, refreshRequestSignal, refreshResultSignal, type RefreshOutcome } from '../shared/refresh-signal';
import type { ListScope } from '../shared/list-scope';
import { inventoryExchange } from './inventory-exchange';
import {
  createListRecord,
  familyIdOf,
  isGridFamily,
  isPickerFamily,
  needsRefresh,
  type Family,
  type ListRecord,
  type PageRequest,
  type ReceivedCard,
} from './list-families';
import { REFRESH_POLICY, refreshFamilies, type RefreshEnv, type RefreshReport } from './list-refresh';
import { crawlList } from './price-crawl';
import { crawlDocumentOf } from './price-document';
import { priceExchange } from './price-exchange';
import type { ViewHost } from './price-view';
import { createPriceViews, type PriceViews } from './price-views';

const FORGE_OPERATION = 'forgeCards';
const TRADE_OPERATIONS = ['acceptCardTrade', 'acceptCardOffer'];
export const AUTO_REFRESH_MAX_PAGES = 25;
const VIEWS_RESTARTED_BY_REFRESH: readonly ListScope[] = ['picker'];

interface ForgeAnswer {
  userId?: unknown;
  addUserCards?: unknown;
}

function forgePlan(forged: ForgeAnswer | null | undefined, families: Family[]): Family[] {
  if (!forged) return [];
  const received = Array.isArray(forged.addUserCards) ? (forged.addUserCards as ReceivedCard[]) : [];
  return families.filter((family) => family.filters.userId === forged.userId && needsRefresh(family, received));
}

const pageCounts = (record: ListRecord): string =>
  record
    .families()
    .map((family) => family.pages.length)
    .join('+');

export function planRefresh(result: OperationResult, families: Family[]): Family[] {
  const name = getOperationName(result.operation.query);
  const data = result.data as Record<string, unknown> | null | undefined;
  if (result.error || !data || !name) return [];
  if (name === FORGE_OPERATION) return forgePlan(data[name] as ForgeAnswer | null | undefined, families);
  const answer = data[name] as { success?: unknown } | null | undefined;
  return TRADE_OPERATIONS.includes(name) && answer?.success === true ? families : [];
}

interface Guard {
  pageWindow: PageWindow;
  debug: (...args: unknown[]) => void;
  record: ListRecord;
  silent: WeakSet<object>;
  pendingFamilyIds: Set<string>;
  sleep: (ms: number) => Promise<void>;
  queue: Promise<unknown>;
  client: Client | null;
}

interface InventoryGuard {
  exchanges: Exchange[];
  attach: (client: Client) => void;
}

const sleepIn =
  (pageWindow: PageWindow) =>
  (ms: number): Promise<void> =>
    ms > 0 ? new Promise<void>((resolve) => pageWindow.setTimeout(resolve, ms)) : Promise.resolve();

function enqueueRefresh(guard: Guard, client: Client, families: Family[]): Promise<RefreshReport> {
  const environment: RefreshEnv = {
    client,
    fetch: (input, init) => guard.pageWindow.fetch(input, init),
    silent: guard.silent,
    record: guard.record,
    sleep: guard.sleep,
  };
  const report = guard.queue.then(() => refreshFamilies(environment, families));
  guard.queue = report.then(
    () => undefined,
    () => undefined
  );
  return report;
}

const publish = (guard: Guard, eventName: string, detail: string) =>
  guard.pageWindow.document.dispatchEvent(new guard.pageWindow.CustomEvent(eventName, { detail }));

function crawlForView(guard: Guard, ...[operation, report, signal]: Parameters<ViewHost['crawl']>): ReturnType<ViewHost['crawl']> {
  const crawlDocument = crawlDocumentOf(operation.query);
  const url: unknown = operation.context.url;
  if (!crawlDocument || typeof url !== 'string' || url === '') {
    guard.debug('price view cannot crawl', { hasDocument: crawlDocument !== null, hasUrl: typeof url === 'string' });
    return Promise.resolve(null);
  }
  const transport: Transport = {
    fetch: (input, init) => guard.pageWindow.fetch(input, init),
    sleep: guard.sleep,
    random: Math.random,
    endpoint: url,
  };
  const variables = (operation.variables ?? {}) as Record<string, unknown>;
  return crawlList({ text: crawlDocument.text, variables, transport, signal, onProgress: report }).then((crawled) => ({
    ...crawled,
    pageSize: crawlDocument.pageSize,
  }));
}

function redriveList(guard: Guard, operation: Operation): void {
  guard.client?.reexecuteOperation(makeOperation(operation.kind, operation, { ...operation.context, requestPolicy: REFRESH_POLICY }));
}

const createGuardViews = (guard: Guard): PriceViews =>
  createPriceViews({
    isReady: () => guard.client !== null,
    crawl: (...request) => crawlForView(guard, ...request),
    redrive: (operation) => redriveList(guard, operation),
    publishState: (scope, state) => publish(guard, priceStateSignal.name, priceStateSignal.encode({ scope, ...state })),
    publishRows: (scope, rows) => publish(guard, priceRowsSignal.name, priceRowsSignal.encode({ scope, ...rows })),
    debug: guard.debug,
  });

function handleMutation(guard: Guard, result: OperationResult): void {
  const plan = planRefresh(result, guard.record.families());
  const client = guard.client;
  guard.debug('inventory change', { recorded: pageCounts(guard.record), refreshing: plan.length });
  if (!client || plan.length === 0) return;
  enqueueRefresh(guard, client, plan).then(
    (report) => guard.debug('lists refreshed', report),
    () => undefined
  );
}

function familiesOf(guard: Guard, scope: ListScope): Family[] {
  const route = guard.pageWindow.location.pathname;
  const isInScope = scope === 'grid' ? isGridFamily : isPickerFamily;
  return guard.record.families().filter((family) => isInScope(family) && family.route === route);
}

async function refreshOnRequest(guard: Guard, priceViews: PriceViews, scope: ListScope): Promise<RefreshOutcome> {
  if (VIEWS_RESTARTED_BY_REFRESH.includes(scope)) priceViews.restart(scope);
  const client = guard.client;
  const families = client ? familiesOf(guard, scope) : [];
  if (!client || families.length === 0) return 'nothing';
  const report = await enqueueRefresh(guard, client, families);
  guard.debug('lists refreshed on request', { scope, ...report });
  return report.failed ? 'failed' : 'done';
}

function refreshOnCacheHit(guard: Guard, page: PageRequest): void {
  const client = guard.client;
  const id = familyIdOf(page.variables);
  const family = guard.record.families().find((known) => known.id === id);
  if (!client || !family || family.pages.length > AUTO_REFRESH_MAX_PAGES || guard.pendingFamilyIds.has(id)) return;
  guard.pendingFamilyIds.add(id);
  void enqueueRefresh(guard, client, [family])
    .then(
      (report) => guard.debug('list refreshed after a cache hit', { pages: family.pages.length, ...report }),
      () => undefined
    )
    .finally(() => guard.pendingFamilyIds.delete(id));
}

const publishRefreshResult = (guard: Guard, scope: ListScope, outcome: RefreshOutcome) =>
  guard.pageWindow.document.dispatchEvent(
    new guard.pageWindow.CustomEvent(refreshResultSignal.name, { detail: refreshResultSignal.encode({ scope, outcome }) })
  );

function handleRefreshRequest(guard: Guard, priceViews: PriceViews, event: Event): void {
  const scope = refreshRequestSignal.read(event)?.scope;
  if (!scope) return;
  void refreshOnRequest(guard, priceViews, scope)
    .catch((): RefreshOutcome => 'failed')
    .then((outcome) => publishRefreshResult(guard, scope, outcome));
}

function handlePriceSwitch(priceViews: PriceViews, event: Event): void {
  const priceSwitch = priceViewSignal.read(event);
  if (!priceSwitch) return;
  if (priceSwitch.isOn) priceViews.start(priceSwitch.scope);
  else priceViews.stop(priceSwitch.scope);
}

function handlePriceOrder(priceViews: PriceViews, event: Event): void {
  const scopedOrder = priceOrderSignal.read(event);
  if (!scopedOrder) return;
  const { scope, ...order } = scopedOrder;
  priceViews.receiveOrder(scope, order);
}

function recordPage(guard: Guard, page: PageRequest): boolean {
  const id = familyIdOf(page.variables);
  const isKnown = guard.record.families().some((family) => family.id === id);
  guard.record.record(page, guard.pageWindow.location.pathname);
  return isKnown;
}

const isSilent = (guard: Guard, context: OperationContext): boolean => typeof context.fetch === 'function' && guard.silent.has(context.fetch);

function attach(guard: Guard, client: Client): void {
  guard.client = client;
  guard.pageWindow.document.documentElement.setAttribute(GUARD_ATTRIBUTE, GUARD_READY);
  guard.debug('urql client', 'attached');
}

export function installInventoryGuard(pageWindow: PageWindow): InventoryGuard {
  const guard: Guard = {
    pageWindow,
    debug: debugLogger(pageWindow),
    record: createListRecord(),
    silent: new WeakSet<object>(),
    pendingFamilyIds: new Set<string>(),
    sleep: sleepIn(pageWindow),
    queue: Promise.resolve(),
    client: null,
  };
  const priceViews = createGuardViews(guard);
  pageWindow.document.addEventListener(refreshRequestSignal.name, (event) => handleRefreshRequest(guard, priceViews, event));
  pageWindow.document.addEventListener(priceViewSignal.name, (event) => handlePriceSwitch(priceViews, event));
  pageWindow.document.addEventListener(priceOrderSignal.name, (event) => handlePriceOrder(priceViews, event));
  const isGuardSilent = (context: OperationContext): boolean => isSilent(guard, context);
  const exchanges = [
    priceExchange(priceViews, isGuardSilent),
    inventoryExchange({
      isSilent: isGuardSilent,
      record: (page) => recordPage(guard, page),
      handleCacheHit: (page) => refreshOnCacheHit(guard, page),
      handleMutation: (result) => handleMutation(guard, result),
    }),
  ];
  return { exchanges, attach: (client) => attach(guard, client) };
}
