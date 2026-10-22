import { debugLogger } from '../shared/debug';
import { findClient, operationName, recordLists, tapMutations, type MutationResult, type QueryClient } from './client-hooks';
import { createListRecord, needsRefresh, type Family, type ListRecord, type ReceivedCard } from './list-families';
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
  const debug = debugLogger(win);
  const record = createListRecord();
  const silent = new WeakSet<object>();
  let queue: Promise<unknown> = Promise.resolve();
  let searched = false;

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

  const attach = () => {
    if (searched) return;
    const client = findClient(win.document);
    if (!client) return;
    searched = true;
    const recording = recordLists(client, (page) => record.record(page), silent);
    const tapping = tapMutations(client, onMutation(client));
    debug('urql client', recording && tapping ? 'attached' : 'not replaceable');
  };

  const nativeFetch = win.fetch.bind(win);
  win.fetch = (...args: Parameters<typeof fetch>) => {
    const pending = nativeFetch(...args);
    pending.then(attach, () => undefined);
    return pending;
  };
}
