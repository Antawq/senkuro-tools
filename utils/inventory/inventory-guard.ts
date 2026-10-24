import { debugLogger } from '../shared/debug';
import type { Transport } from '../shared/graphql';
import { claimPage } from '../shared/page-claim';
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
  type RefreshScope,
} from '../shared/refresh-signal';
import { operationName, runWhenClientFound, type QueryClient } from '../shared/urql-client';
import { recordLists, rewriteLists, tapMutations, type MutationResult } from './client-hooks';
import { createCursorLedger, guardCursors } from './list-cursors';
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
import { learnFromFetch } from './list-seen';
import { REFRESH_POLICY, refreshFamilies, type RefreshEnv, type RefreshReport } from './list-refresh';
import { crawlList } from './price-crawl';
import { crawlDocumentOf } from './price-document';
import { answerPrivateRequests } from './price-fetch';
import { isPrivateVariables } from './price-private';
import { createPriceView, type ListPage } from './price-view';

const FORGE_OPERATION = 'forgeCards';
const TRADE_OPERATIONS = ['acceptCardTrade', 'acceptCardOffer'];
export const AUTO_REFRESH_MAX_PAGES = 25;
const REDRIVE_POLICY = 'network-only';

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

export function installInventoryGuard(win: PageWindow): void {
  if (!claimPage(win, 'inventory-guard')) return;
  const debug = debugLogger(win);
  const record = createListRecord();
  const ledger = createCursorLedger();
  const silent = new WeakSet<object>();
  let queue: Promise<unknown> = Promise.resolve();
  let attachedClient: QueryClient | null = null;

  const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => win.setTimeout(resolve, ms)) : Promise.resolve());

  const environment = (client: QueryClient): RefreshEnv => ({ client, fetch: (input, init) => win.fetch(input, init), silent, record, sleep });

  const enqueueRefresh = (client: QueryClient, families: Family[]): Promise<RefreshReport> => {
    const report = queue.then(() => refreshFamilies(environment(client), families));
    queue = report.then(
      () => undefined,
      () => undefined
    );
    return report;
  };

  const publish = (eventName: string, detail: string) => win.document.dispatchEvent(new win.CustomEvent(eventName, { detail }));

  const priceView = createPriceView({
    isReady: () => typeof attachedClient?.createRequestOperation === 'function' && typeof attachedClient.reexecuteOperation === 'function',
    crawl: (page, report, signal) => {
      const document = crawlDocumentOf(page.request.query);
      const url = apiUrlOf(attachedClient, page);
      if (!document || !url) {
        debug('price view cannot crawl', { hasDocument: document !== null, hasUrl: url !== null });
        return Promise.resolve(null);
      }
      const transport: Transport = {
        fetch: (input, init) => win.fetch(input, init),
        sleep: (delayMs) => new Promise((resolve) => win.setTimeout(resolve, delayMs)),
        random: Math.random,
        endpoint: url,
      };
      return crawlList({ text: document.text, variables: page.request.variables ?? {}, transport, signal, onProgress: report }).then((crawled) => ({
        ...crawled,
        pageSize: document.pageSize,
      }));
    },
    redrive: (page, variables) => {
      const client = attachedClient;
      if (!client?.createRequestOperation || !client.reexecuteOperation) return;
      client.reexecuteOperation(client.createRequestOperation('query', { ...page.request, variables }, { ...page.options, requestPolicy: REDRIVE_POLICY }));
    },
    refreshPage: (page, variables) => {
      void attachedClient
        ?.query(page.request.query, variables, { ...page.options, requestPolicy: REFRESH_POLICY })
        .toPromise()
        .catch(() => undefined);
    },
    publishState: (state) => publish(PRICE_STATE_EVENT, encodePriceState(state)),
    publishRows: (rows) => publish(PRICE_ROWS_EVENT, encodePriceRows(rows)),
    debug,
  });

  const onMutation = (client: QueryClient) => (result: MutationResult) => {
    priceView.handleMutation(result);
    const plan = planRefresh(result, record.families());
    debug('inventory change', { recorded: pageCounts(record), refreshing: plan.length });
    if (plan.length === 0) return;
    enqueueRefresh(client, plan).then(
      (report) => debug('lists refreshed', report),
      () => undefined
    );
  };

  const familiesOf = (scope: RefreshScope): Family[] => {
    const route = win.location.pathname;
    const isInScope = scope === 'grid' ? isGridFamily : isPickerFamily;
    return record.families().filter((family) => isInScope(family) && family.route === route);
  };

  const refreshOnRequest = async (scope: RefreshScope): Promise<RefreshOutcome> => {
    const client = attachedClient;
    const families = client ? familiesOf(scope) : [];
    if (!client || families.length === 0) return 'nothing';
    const report = await enqueueRefresh(client, families);
    debug('lists refreshed on request', { scope, ...report });
    return report.failed ? 'failed' : 'done';
  };

  const pendingFamilyIds = new Set<string>();

  const refreshOnCacheHit = (page: PageRequest) => {
    const client = attachedClient;
    const id = familyIdOf(page.variables);
    const family = record.families().find((known) => known.id === id);
    if (!client || !family || family.pages.length > AUTO_REFRESH_MAX_PAGES || pendingFamilyIds.has(id)) return;
    pendingFamilyIds.add(id);
    void enqueueRefresh(client, [family])
      .then(
        (report) => debug('list refreshed after a cache hit', { pages: family.pages.length, ...report }),
        () => undefined
      )
      .finally(() => pendingFamilyIds.delete(id));
  };

  const publishRefreshResult = (scope: RefreshScope, outcome: RefreshOutcome) =>
    win.document.dispatchEvent(new win.CustomEvent(REFRESH_RESULT_EVENT, { detail: encodeRefreshResult({ scope, outcome }) }));

  win.document.addEventListener(REFRESH_REQUEST_EVENT, (event) => {
    const scope = readRefreshRequest(event);
    if (!scope) return;
    void refreshOnRequest(scope)
      .catch((): RefreshOutcome => 'failed')
      .then((outcome) => publishRefreshResult(scope, outcome));
  });

  win.document.addEventListener(PRICE_VIEW_EVENT, (event) => {
    const isOn = readPriceSwitch(event);
    if (isOn === null) return;
    if (isOn) priceView.start();
    else priceView.stop();
  });
  win.document.addEventListener(PRICE_ORDER_EVENT, (event) => {
    const order = readPriceOrder(event);
    if (order) priceView.receiveOrder(order);
  });

  learnFromFetch(win, ledger);
  answerPrivateRequests(win, priceView);

  runWhenClientFound(win, (client) => {
    attachedClient = client;
    const isRecording = recordLists(
      client,
      (page) => {
        if (!isPrivateVariables(page.variables)) record.record(page, win.location.pathname);
      },
      silent,
      refreshOnCacheHit
    );
    const isTapping = tapMutations(client, onMutation(client));
    const isGuarding = guardCursors(client, (variables) => debug('stale cursor dropped', { list: familyIdOf(variables), after: variables.after }), ledger);
    const isRewriting = rewriteLists(client, priceView);
    const isAttached = isRecording && isTapping && isGuarding && isRewriting;
    if (isAttached) win.document.documentElement.setAttribute(GUARD_ATTRIBUTE, GUARD_READY);
    debug('urql client', isAttached ? 'attached' : 'not replaceable');
  });
}
