import { debugLogger } from '../shared/debug';
import { LIST_LOAD_EVENT, LIST_LOADED_EVENT, encodeLoaded } from '../shared/list-signal';
import { claimPage } from '../shared/page-claim';
import { operationName, whenClient, type QueryClient } from '../shared/urql-client';
import { recordLists, tapMutations, type MutationResult } from './client-hooks';
import { createCursorLedger, guardCursors } from './list-cursors';
import { createListRecord, familyIdOf, needsRefresh, type Family, type ListRecord, type PageRequest, type ReceivedCard } from './list-families';
import { loadRest } from './list-loader';
import { learnFromFetch } from './list-seen';
import { refreshFamilies, type RefreshEnv } from './list-refresh';

const FORGE_OPERATION = 'forgeCards';
const TRADE_OPERATIONS = ['acceptCardTrade', 'acceptCardOffer'];

type GuardWindow = Window & typeof globalThis;

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

export function installInventoryGuard(win: GuardWindow): void {
  if (!claimPage(win, 'inventory-guard')) return;
  const debug = debugLogger(win);
  const record = createListRecord();
  const ledger = createCursorLedger();
  const silent = new WeakSet<object>();
  let queue: Promise<unknown> = Promise.resolve();
  let latest: PageRequest | null = null;
  let attached: QueryClient | null = null;
  let loading = false;

  const environment = (client: QueryClient): RefreshEnv => ({ client, fetch: (input, init) => win.fetch(input, init), silent, record });

  const onMutation = (client: QueryClient) => (result: MutationResult) => {
    const plan = planRefresh(result, record.families());
    debug('inventory change', { recorded: pageCounts(record), refreshing: plan.length });
    if (plan.length === 0) return;
    queue = queue
      .then(() => refreshFamilies(environment(client), plan))
      .then(
        (report) => debug('lists refreshed', report),
        () => undefined
      );
  };

  const answer = (complete: boolean) => win.document.dispatchEvent(new win.CustomEvent(LIST_LOADED_EVENT, { detail: encodeLoaded(complete) }));
  const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => win.setTimeout(resolve, ms)) : Promise.resolve());

  win.document.addEventListener(LIST_LOAD_EVENT, () => {
    if (loading) return;
    if (!attached) {
      answer(false);
      return;
    }
    loading = true;
    void loadRest({ client: attached, latest: () => latest, sleep }).then((complete) => {
      loading = false;
      answer(complete);
    });
  });

  learnFromFetch(win, ledger);

  whenClient(win, (client) => {
    attached = client;
    const recording = recordLists(
      client,
      (page) => {
        latest = page;
        record.record(page);
      },
      silent
    );
    const tapping = tapMutations(client, onMutation(client));
    const guarding = guardCursors(client, (variables) => debug('stale cursor dropped', { list: familyIdOf(variables), after: variables.after }), ledger);
    debug('urql client', recording && tapping && guarding ? 'attached' : 'not replaceable');
  });
}
