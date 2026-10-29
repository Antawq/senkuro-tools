import type { Client, Exchange, OperationContext, OperationResult } from '@urql/core';

import { debugLogger } from '../shared/debug';
import type { Transport } from '../shared/graphql';
import type { PageWindow } from '../shared/page-window';
import {
  PRICE_ORDER_EVENT,
  PRICE_ROWS_EVENT,
  PRICE_STATE_EVENT,
  PRICE_VIEW_EVENT,
  encodePriceRows,
  encodePriceState,
  readPriceOrder,
  readPriceSwitch,
} from '../shared/price-signal';
import {
  GUARD_ATTRIBUTE,
  GUARD_READY,
  REFRESH_REQUEST_EVENT,
  REFRESH_RESULT_EVENT,
  encodeRefreshResult,
  readRefreshRequest,
  type RefreshOutcome,
} from '../shared/refresh-signal';
import type { ListScope } from '../shared/list-scope';
import { operationName, type QueryClient } from '../shared/urql-client';
import { rewriteLists, type MutationResult } from './client-hooks';
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
import { answerPrivateRequests } from './price-fetch';
import type { ListPage, ViewHost } from './price-view';
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

export function planRefresh(result: MutationResult, families: Family[]): Family[] {
  const name = result.operation ? operationName(result.operation) : undefined;
  if (result.error || !result.data || !name) return [];
  if (name === FORGE_OPERATION) return forgePlan(result.data[name] as ForgeAnswer | null | undefined, families);
  const answer = result.data[name] as { success?: unknown } | null | undefined;
  return TRADE_OPERATIONS.includes(name) && answer?.success === true ? families : [];
}

function apiUrlOf(client: QueryClient | null, page: ListPage): string | null {
  try {
    const operation = client?.createRequestOperation?.('query', page.request) as { context?: { url?: unknown } } | undefined;
    return typeof operation?.context?.url === 'string' ? operation.context.url : null;
  } catch {
    return null;
  }
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
  siteClient: QueryClient | null;
}

export interface InventoryGuard {
  exchange: Exchange;
  attach: (client: Client, siteClient: Client) => void;
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

const isViewReady = (guard: Guard): boolean =>
  typeof guard.siteClient?.createRequestOperation === 'function' && typeof guard.siteClient.reexecuteOperation === 'function';

function crawlForView(guard: Guard, ...[page, report, signal]: Parameters<ViewHost['crawl']>): ReturnType<ViewHost['crawl']> {
  const crawlDocument = crawlDocumentOf(page.request.query);
  const url = apiUrlOf(guard.siteClient, page);
  if (!crawlDocument || !url) {
    guard.debug('price view cannot crawl', { hasDocument: crawlDocument !== null, hasUrl: url !== null });
    return Promise.resolve(null);
  }
  const transport: Transport = {
    fetch: (input, init) => guard.pageWindow.fetch(input, init),
    sleep: guard.sleep,
    random: Math.random,
    endpoint: url,
  };
  return crawlList({ text: crawlDocument.text, variables: page.request.variables ?? {}, transport, signal, onProgress: report }).then((crawled) => ({
    ...crawled,
    pageSize: crawlDocument.pageSize,
  }));
}

function redriveList(guard: Guard, ...[page, variables]: Parameters<ViewHost['redrive']>): void {
  const client = guard.siteClient;
  if (!client?.createRequestOperation || !client.reexecuteOperation) return;
  client.reexecuteOperation(client.createRequestOperation('query', { ...page.request, variables }, { ...page.options, requestPolicy: REFRESH_POLICY }));
}

function refreshServedPage(guard: Guard, ...[page, variables]: Parameters<ViewHost['refreshPage']>): void {
  void guard.siteClient
    ?.query(page.request.query, variables, { ...page.options, requestPolicy: REFRESH_POLICY })
    .toPromise()
    .catch(() => undefined);
}

const createGuardViews = (guard: Guard): PriceViews =>
  createPriceViews({
    isReady: () => isViewReady(guard),
    crawl: (...request) => crawlForView(guard, ...request),
    redrive: (...request) => redriveList(guard, ...request),
    refreshPage: (...request) => refreshServedPage(guard, ...request),
    publishState: (scope, state) => publish(guard, PRICE_STATE_EVENT, encodePriceState({ scope, state })),
    publishRows: (scope, rows) => publish(guard, PRICE_ROWS_EVENT, encodePriceRows({ scope, rows })),
    debug: guard.debug,
  });

function handleMutation(guard: Guard, priceViews: PriceViews, result: OperationResult): void {
  const mutation = result as unknown as MutationResult;
  priceViews.handleMutation(mutation);
  const plan = planRefresh(mutation, guard.record.families());
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
  guard.pageWindow.document.dispatchEvent(new guard.pageWindow.CustomEvent(REFRESH_RESULT_EVENT, { detail: encodeRefreshResult({ scope, outcome }) }));

function handleRefreshRequest(guard: Guard, priceViews: PriceViews, event: Event): void {
  const scope = readRefreshRequest(event);
  if (!scope) return;
  void refreshOnRequest(guard, priceViews, scope)
    .catch((): RefreshOutcome => 'failed')
    .then((outcome) => publishRefreshResult(guard, scope, outcome));
}

function handlePriceSwitch(priceViews: PriceViews, event: Event): void {
  const priceSwitch = readPriceSwitch(event);
  if (!priceSwitch) return;
  if (priceSwitch.isOn) priceViews.start(priceSwitch.scope);
  else priceViews.stop(priceSwitch.scope);
}

function handlePriceOrder(priceViews: PriceViews, event: Event): void {
  const scoped = readPriceOrder(event);
  if (scoped) priceViews.receiveOrder(scoped.scope, scoped.order);
}

function recordPage(guard: Guard, page: PageRequest): boolean {
  const id = familyIdOf(page.variables);
  const isKnown = guard.record.families().some((family) => family.id === id);
  guard.record.record(page, guard.pageWindow.location.pathname);
  return isKnown;
}

const isSilent = (guard: Guard, context: OperationContext): boolean => typeof context.fetch === 'function' && guard.silent.has(context.fetch);

function attach(guard: Guard, priceViews: PriceViews, client: Client, siteClient: Client): void {
  guard.client = client;
  guard.siteClient = siteClient as unknown as QueryClient;
  const isRewriting = rewriteLists(guard.siteClient, priceViews, guard.silent);
  if (isRewriting) guard.pageWindow.document.documentElement.setAttribute(GUARD_ATTRIBUTE, GUARD_READY);
  guard.debug('urql client', isRewriting ? 'attached' : 'not replaceable');
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
    siteClient: null,
  };
  const priceViews = createGuardViews(guard);
  pageWindow.document.addEventListener(REFRESH_REQUEST_EVENT, (event) => handleRefreshRequest(guard, priceViews, event));
  pageWindow.document.addEventListener(PRICE_VIEW_EVENT, (event) => handlePriceSwitch(priceViews, event));
  pageWindow.document.addEventListener(PRICE_ORDER_EVENT, (event) => handlePriceOrder(priceViews, event));
  answerPrivateRequests(pageWindow, priceViews);
  const exchange = inventoryExchange({
    isSilent: (context) => isSilent(guard, context),
    record: (page) => recordPage(guard, page),
    handleCacheHit: (page) => refreshOnCacheHit(guard, page),
    handleMutation: (result) => handleMutation(guard, priceViews, result),
  });
  return { exchange, attach: (client, siteClient) => attach(guard, priceViews, client, siteClient) };
}
