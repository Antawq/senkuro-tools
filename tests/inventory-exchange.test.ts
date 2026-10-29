import { describe, expect, it } from 'vitest';

import { Client, gql, makeOperation, makeResult, type CacheOutcome, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { filter, fromArray, makeSubject, merge, mergeMap, pipe, share, take, toPromise } from 'wonka';

import { inventoryExchange, type InventoryHost } from '../utils/inventory/inventory-exchange';
import { createCursorLedger, cursorExchange } from '../utils/inventory/list-cursors';
import { familyIdOf, type PageRequest, type Variables } from '../utils/inventory/list-families';
import { delegateExchange } from '../utils/shared/delegate-exchange';
import { SITE_URL, createSiteClient, nameOf, tick } from './helpers/site-client';

const LIST = gql`
  query fetchUserCards($userId: ID!, $after: String) {
    userCards(first: 20, userId: $userId, after: $after) {
      edges {
        node {
          modifier
        }
      }
    }
  }
`;

const VIEWER = gql`
  query fetchViewer {
    viewer {
      id
    }
  }
`;

const FORGE = gql`
  mutation forgeCards($input: ID!) {
    forgeCards(input: $input) {
      userId
    }
  }
`;

const grid = (after?: string | null): Variables => ({ userId: 'USER:1', modifier: { include: [0] }, ...(after === undefined ? {} : { after }) });

interface SiteResult {
  cacheOutcome?: CacheOutcome;
  stale?: boolean;
  hasNext?: boolean;
}

const resultFor = (operation: Operation, { cacheOutcome, stale = false, hasNext = false }: SiteResult): OperationResult => {
  const answered = cacheOutcome ? makeOperation(operation.kind, operation, { ...operation.context, meta: { cacheOutcome } }) : operation;
  const data = operation.kind === 'mutation' ? { forgeCards: { userId: 'USER:1' } } : { userCards: { edges: [] } };
  return { ...makeResult(answered, { data }), stale, hasNext };
};

const rig = (answers: (operation: Operation) => SiteResult[] = () => [{ cacheOutcome: 'miss' }], silent = new WeakSet<object>()) => {
  const pushed = makeSubject<OperationResult>();
  const siteOperations: Operation[] = [];
  const site: Exchange = () => (operations$) => {
    const results$ = pipe(
      operations$,
      filter((operation: Operation) => operation.kind !== 'teardown'),
      mergeMap((operation: Operation) => {
        siteOperations.push(operation);
        return fromArray(answers(operation).map((answer) => resultFor(operation, answer)));
      })
    );
    return share(merge([results$, pushed.source]));
  };
  const siteClient = new Client({ url: SITE_URL, exchanges: [site] });
  const pages: PageRequest[] = [];
  const knownIds = new Set<string>();
  const cacheHits: PageRequest[] = [];
  const mutations: OperationResult[] = [];
  const host: InventoryHost = {
    isSilent: (context) => typeof context.fetch === 'function' && silent.has(context.fetch),
    record: (page) => {
      const id = familyIdOf(page.variables);
      const isKnown = knownIds.has(id);
      knownIds.add(id);
      pages.push(page);
      return isKnown;
    },
    handleCacheHit: (page) => void cacheHits.push(page),
    handleMutation: (result) => void mutations.push(result),
  };
  const client = new Client({ url: SITE_URL, exchanges: [inventoryExchange(host), delegateExchange(siteClient)] });
  const browse = (variables: Variables, context?: Record<string, unknown>) => client.query(LIST, variables, context).subscribe(() => undefined);
  return { client, host, pages, cacheHits, mutations, siteOperations, pushed, browse };
};

describe('inventoryExchange recording', () => {
  it('records every list query with its document, variables and the options the caller set minus the policy, and still runs it', async () => {
    const { pages, siteOperations, browse } = rig();
    const subscription = browse(grid('c1'), { requestPolicy: 'cache-and-network', additionalTypenames: ['UserCard'] });
    await tick();
    expect(pages).toEqual([{ document: LIST, variables: grid('c1'), options: { additionalTypenames: ['UserCard'] } }]);
    expect(siteOperations.filter((operation) => nameOf(operation) === 'fetchUserCards')).toHaveLength(1);
    subscription.unsubscribe();
  });

  it('ignores other operations and its own silent replays', async () => {
    const silent = new WeakSet<object>();
    const capture = () => Promise.resolve(new Response());
    silent.add(capture);
    const { pages, client, browse } = rig(() => [{}], silent);
    await client.query(VIEWER, {}).toPromise();
    const subscription = browse(grid(), { fetch: capture });
    await tick();
    expect(pages).toEqual([]);
    subscription.unsubscribe();
  });

  it('is fed the repaired request when the cursor guard is in front of it, so a replay never carries a foreign cursor', async () => {
    const ledger = createCursorLedger();
    ledger.learn({ ...grid(), modifier: { include: [1] } }, 'c1');
    const pages: PageRequest[] = [];
    const host: InventoryHost = {
      isSilent: () => false,
      record: (page) => (pages.push(page), false),
      handleCacheHit: () => undefined,
      handleMutation: () => undefined,
    };
    const site = createSiteClient(() => ({ data: { userCards: { edges: [] } } }));
    const client = new Client({ url: SITE_URL, exchanges: [cursorExchange(ledger), inventoryExchange(host), delegateExchange(site.client)] });
    await client.query(LIST, grid('c1')).toPromise();
    await client.query(LIST, { ...grid(), modifier: { include: [1] }, after: 'c1' }).toPromise();
    expect(pages.map((page) => page.variables)).toEqual([grid(null), { ...grid(), modifier: { include: [1] }, after: 'c1' }]);
  });
});

describe('inventoryExchange and mutations', () => {
  it('reports a settled mutation once, after the site client has applied it, and the site runs it once', async () => {
    const { client, mutations, siteOperations } = rig(() => [{}]);
    const result = await client.mutation(FORGE, { input: 'c1' }).toPromise();
    expect(result.data).toEqual({ forgeCards: { userId: 'USER:1' } });
    expect(mutations).toHaveLength(1);
    expect(nameOf(mutations[0]!.operation)).toBe('forgeCards');
    expect(siteOperations.filter((operation) => operation.kind === 'mutation')).toHaveLength(1);
  });

  it('reports once however the caller reads the mutation: awaited, as a promise, subscribed or piped', async () => {
    const reads = [
      (client: Client) => client.mutation(FORGE, { input: 'c1' }).then((result) => result),
      (client: Client) => client.mutation(FORGE, { input: 'c1' }).toPromise(),
      (client: Client) => new Promise<OperationResult>((resolve) => client.mutation(FORGE, { input: 'c1' }).subscribe(resolve)),
      (client: Client) => pipe(client.mutation(FORGE, { input: 'c1' }), take(1), toPromise),
    ];
    for (const read of reads) {
      const { client, mutations, siteOperations } = rig(() => [{}]);
      await read(client);
      expect(mutations).toHaveLength(1);
      expect(siteOperations.filter((operation) => operation.kind === 'mutation')).toHaveLength(1);
    }
  });

  it('does not report a streaming result, only the settled one', async () => {
    const { client, mutations } = rig(() => [{ hasNext: true }, {}]);
    await client.mutation(FORGE, { input: 'c1' }).toPromise();
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.hasNext).toBe(false);
  });

  it('keeps the results flowing when the host throws', async () => {
    const { client, host } = rig(() => [{}]);
    host.handleMutation = () => {
      throw new Error('boom');
    };
    expect((await client.mutation(FORGE, { input: 'c1' }).toPromise()).data).toEqual({ forgeCards: { userId: 'USER:1' } });
    expect((await client.query(VIEWER, {}).toPromise()).data).toBeDefined();
  });
});

describe('inventoryExchange and the first page of a list shown from the cache', () => {
  const revisit = async (results: SiteResult[], variables = grid(), seen: OperationResult[] = []) => {
    const answers = [[{ cacheOutcome: 'miss' as CacheOutcome }], results];
    let call = 0;
    const subject = rig(() => answers[Math.min(call++, answers.length - 1)] ?? []);
    subject.browse(grid('c1')).unsubscribe();
    await tick();
    const subscription = subject.client.query(LIST, variables).subscribe((result) => seen.push(result));
    await tick();
    return { ...subject, subscription, seen };
  };

  it('reports the first page of a list it saw before when the cache answered it, once however many results follow', async () => {
    const { cacheHits, seen, subscription } = await revisit([{ cacheOutcome: 'hit' }, { cacheOutcome: 'hit' }, { cacheOutcome: 'hit' }]);
    expect(cacheHits.map((page) => page.variables)).toEqual([grid()]);
    expect(seen).toHaveLength(3);
    subscription.unsubscribe();
  });

  it('leaves the first page of a list it sees for the first time alone, as on the re-run of every query the swap causes', async () => {
    const { cacheHits, browse } = rig(() => [{ cacheOutcome: 'hit' }]);
    const subscription = browse(grid());
    await tick();
    expect(cacheHits).toEqual([]);
    subscription.unsubscribe();
  });

  it('ignores a first page the network answered or the cache answered only in part', async () => {
    expect((await revisit([{ cacheOutcome: 'miss' }])).cacheHits).toEqual([]);
    expect((await revisit([{ cacheOutcome: 'partial' }])).cacheHits).toEqual([]);
    expect((await revisit([{}])).cacheHits).toEqual([]);
  });

  it('judges only the first settled result after a request, so a later result never starts anything', async () => {
    expect((await revisit([{ cacheOutcome: 'miss' }, { cacheOutcome: 'hit' }])).cacheHits).toEqual([]);
    expect((await revisit([{ cacheOutcome: 'hit', stale: true }, { cacheOutcome: 'miss' }])).cacheHits).toEqual([]);
  });

  it('ignores a cache hit the site client pushes for a list with no new request, as after its own update of the cache', async () => {
    const { cacheHits, pushed, subscription, seen } = await revisit([{ cacheOutcome: 'miss' }]);
    const operation = seen[0]!.operation;
    pushed.next(resultFor(operation, { cacheOutcome: 'hit' }));
    pushed.next(resultFor(operation, { cacheOutcome: 'hit' }));
    await tick();
    expect(cacheHits).toEqual([]);
    subscription.unsubscribe();
  });

  it('stops waiting for the first answer of a list when a replay of it comes first, so the answer of the replay starts nothing', async () => {
    const silent = new WeakSet<object>();
    const capture = () => Promise.resolve(new Response());
    silent.add(capture);
    const answers: SiteResult[][] = [[{ cacheOutcome: 'miss' }], [{ cacheOutcome: 'hit', stale: true }], [{ cacheOutcome: 'hit' }]];
    const { client, cacheHits, browse } = rig(() => answers.shift() ?? [], silent);
    browse(grid('c1')).unsubscribe();
    await tick();
    const subscription = browse(grid());
    await tick();
    await client.query(LIST, grid(), { requestPolicy: 'network-only', fetch: capture }).toPromise();
    expect(cacheHits).toEqual([]);
    subscription.unsubscribe();
  });

  it('ignores a later page and a request of another operation', async () => {
    expect((await revisit([{ cacheOutcome: 'hit' }], grid('c1'))).cacheHits).toEqual([]);
    const { client, cacheHits } = rig(() => [{ cacheOutcome: 'hit' }]);
    await client.query(VIEWER, {}).toPromise();
    await client.query(VIEWER, {}).toPromise();
    expect(cacheHits).toEqual([]);
  });

  it('records a page without its request policy, so a replay sets its own', async () => {
    const { pages, browse } = rig();
    browse(grid(), { requestPolicy: 'network-only' }).unsubscribe();
    await tick();
    expect(pages.map((page) => page.options)).toEqual([{}]);
  });
});
