import { debugLogger } from '../shared/debug';
import { LIST_LOAD_EVENT, LIST_LOADED_EVENT, encodeLoaded, type LoadOutcome } from '../shared/list-signal';
import { claimPage } from '../shared/page-claim';
import type { PageWindow } from '../shared/page-window';
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
import { recordLists, tapMutations, type MutationResult } from './client-hooks';
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
import { loadRest } from './list-loader';
import { learnFromFetch } from './list-seen';
import { refreshFamilies, type RefreshEnv, type RefreshReport } from './list-refresh';

const FORGE_OPERATION = 'forgeCards';
const TRADE_OPERATIONS = ['acceptCardTrade', 'acceptCardOffer'];
export const AUTO_REFRESH_MAX_PAGES = 25;

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

export function installInventoryGuard(win: PageWindow): void {
  if (!claimPage(win, 'inventory-guard')) return;
  const debug = debugLogger(win);
  const record = createListRecord();
  const ledger = createCursorLedger();
  const silent = new WeakSet<object>();
  let queue: Promise<unknown> = Promise.resolve();
  let latestPage: PageRequest | null = null;
  let attachedClient: QueryClient | null = null;
  let isLoading = false;

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

  const onMutation = (client: QueryClient) => (result: MutationResult) => {
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

  const pendingFamilies = new Set<string>();

  const refreshOnCacheHit = (page: PageRequest) => {
    const client = attachedClient;
    const id = familyIdOf(page.variables);
    const family = record.families().find((known) => known.id === id);
    if (!client || !family || family.pages.length > AUTO_REFRESH_MAX_PAGES || pendingFamilies.has(id)) return;
    pendingFamilies.add(id);
    void enqueueRefresh(client, [family])
      .then(
        (report) => debug('list refreshed after a cache hit', { pages: family.pages.length, ...report }),
        () => undefined
      )
      .finally(() => pendingFamilies.delete(id));
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

  const publishListLoaded = (outcome: LoadOutcome) => win.document.dispatchEvent(new win.CustomEvent(LIST_LOADED_EVENT, { detail: encodeLoaded(outcome) }));

  const refreshLatestList = (client: QueryClient): Promise<unknown> => {
    const id = latestPage ? familyIdOf(latestPage.variables) : null;
    const family = record.families().find((known) => known.id === id);
    return family ? enqueueRefresh(client, [family]).catch(() => undefined) : Promise.resolve();
  };

  win.document.addEventListener(LIST_LOAD_EVENT, () => {
    if (isLoading) return;
    const client = attachedClient;
    if (!client) {
      publishListLoaded('partial');
      return;
    }
    isLoading = true;
    void refreshLatestList(client)
      .then(() => loadRest({ client, latestPage: () => latestPage, sleep }))
      .then((outcome) => {
        isLoading = false;
        publishListLoaded(outcome);
      });
  });

  learnFromFetch(win, ledger);

  runWhenClientFound(win, (client) => {
    attachedClient = client;
    const isRecording = recordLists(
      client,
      (page) => {
        latestPage = page;
        record.record(page, win.location.pathname);
      },
      silent,
      refreshOnCacheHit
    );
    const isTapping = tapMutations(client, onMutation(client));
    const isGuarding = guardCursors(client, (variables) => debug('stale cursor dropped', { list: familyIdOf(variables), after: variables.after }), ledger);
    const isAttached = isRecording && isTapping && isGuarding;
    if (isAttached) win.document.documentElement.setAttribute(GUARD_ATTRIBUTE, GUARD_READY);
    debug('urql client', isAttached ? 'attached' : 'not replaceable');
  });
}
