import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';
import {
  Client,
  createRequest,
  gql,
  makeErrorResult,
  makeOperation,
  makeResult,
  type CacheOutcome,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { filter, fromArray, fromPromise, mergeMap, pipe, subscribe } from 'wonka';

import { LIST_OPERATION, createListRecord, type Variables } from '../utils/inventory/list-families';
import { AUTO_REFRESH_MAX_PAGES, installInventoryGuard, planRefresh } from '../utils/inventory/inventory-guard';
import { REFRESH_POLICY } from '../utils/inventory/list-refresh';
import { createPrivateCursor, hasPrivateCursor } from '../utils/inventory/price-private';
import type { Row } from '../utils/inventory/price-crawl';
import { delegateExchange } from '../utils/shared/delegate-exchange';
import {
  GUARD_ATTRIBUTE,
  GUARD_READY,
  REFRESH_REQUEST_EVENT,
  REFRESH_RESULT_EVENT,
  encodeRefreshRequest,
  readRefreshResult,
  type RefreshResult,
} from '../utils/shared/refresh-signal';
import type { ListScope } from '../utils/shared/list-scope';
import {
  PRICE_ORDER_EVENT,
  PRICE_ROWS_EVENT,
  PRICE_STATE_EVENT,
  PRICE_VIEW_EVENT,
  encodePriceOrder,
  encodePriceSwitch,
  readPriceRows,
  readPriceState,
  type PriceRows,
  type PriceState,
  type ScopedRows,
} from '../utils/shared/price-signal';

const GRAPHQL = 'https://api.senkuro.me/graphql';

const LIST = gql`
  query fetchUserCards($after: String, $userId: ID!, $orderField: UserCardOrderField, $orderDirection: OrderDirection) {
    userCards(first: 2, after: $after, userId: $userId, orderBy: { field: $orderField, direction: $orderDirection }) {
      edges {
        node {
          modifier
          card {
            id
            slug
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const mutationDocument = (name: string) => gql(`mutation ${name}($input: ID) { ${name}(input: $input) { success } }`);

const splitPicker = (userId: string, after?: string): Variables => ({
  userId,
  ...(after ? { after } : {}),
  rank: { include: [], exclude: ['F'] },
  modifier: { exclude: [1] },
  animated: false,
});

const profileGrid = (userId: string): Variables => ({ userId });

const cardsGrid = (userId: string, after?: string): Variables => ({
  userId,
  ...(after ? { after } : {}),
  modifier: { include: [0] },
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
});

const operations = new Client({ url: 'https://api.senkuro.me/graphql', exchanges: [] });

const received = (rank: string) => ({ modifier: 0, card: { id: `id-${rank}`, rank, animated: false, explicit: false } });

const forgedData = (userId: string, ranks: string[]) => ({ forgeCards: { userId, addUserCards: ranks.map(received) } });

const acceptedData = (name: string, success = true) => ({ [name]: { success } });

const mutationResult = (name: string, data: Record<string, unknown> | null, error?: Error): OperationResult => {
  const operation = operations.createRequestOperation('mutation', { key: 1, query: mutationDocument(name), variables: {} });
  return error ? makeErrorResult(operation, error) : makeResult(operation, { data });
};

const page = { data: { userCards: { pageInfo: { endCursor: 'c1', hasNextPage: false }, edges: [{ node: { modifier: 0, card: { id: 'c1' } } }] } } };

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const until = async (done: () => boolean) => {
  for (let pass = 0; pass < 200 && !done(); pass++) await settle();
};

type Init = NonNullable<Parameters<Window['fetch']>[1]>;

interface SiteMutation {
  name: string;
  data?: Record<string, unknown> | null;
  error?: Error;
  variables?: Variables;
}

interface Rig {
  answer?: unknown;
  mounted?: boolean;
  mutations?: SiteMutation[];
  slow?: boolean;
  outcomes?: CacheOutcome[];
  onFetch?: (body: string) => unknown;
}

interface SiteCall {
  variables: Variables;
  options: Record<string, unknown>;
}

const keyOf = (variables: Variables): number => createRequest(LIST, variables).key;

const rig = ({ answer = {}, mounted = true, mutations = [], slow = false, outcomes, onFetch }: Rig = {}) => {
  const win = new Window({ url: 'https://senkuro.me/forge/split' });
  win.document.body.innerHTML = '<div id="app"></div>';
  const queries: SiteCall[] = [];
  const reached: Variables[] = [];
  const redriven: Operation[] = [];
  const log: string[] = [];
  const pending = [...mutations];
  const fetched: string[] = [];
  const fetchedUrls: string[] = [];
  win.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    fetched.push(body);
    fetchedUrls.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
    return Promise.resolve(new Response(JSON.stringify(onFetch ? onFetch(body) : page)));
  }) as unknown as typeof win.fetch;

  const replay = async (operation: Operation): Promise<OperationResult> => {
    const variables = operation.variables as Variables;
    const options = operation.context as unknown as Record<string, unknown>;
    queries.push({ variables, options });
    const index = queries.length - 1;
    log.push(`start ${String(variables.userId)}`);
    if (slow) await new Promise((resolve) => setTimeout(resolve, 15));
    await (options.fetch as (input: string, init: Init) => Promise<Response>)(GRAPHQL, {
      method: 'POST',
      body: JSON.stringify({ operationName: LIST_OPERATION, variables }),
    });
    log.push(`end ${String(variables.userId)}`);
    const answered = (typeof answer === 'function' ? (answer as (at: number) => unknown)(index) : answer) as { data?: unknown; error?: Error };
    return answered.error ? makeErrorResult(operation, answered.error) : makeResult(operation, { data: answered.data ?? {} });
  };

  const browseResults = (operation: Operation): OperationResult[] =>
    (outcomes ?? ['miss']).map((cacheOutcome) =>
      makeResult(makeOperation(operation.kind, operation, { ...operation.context, meta: { cacheOutcome } }), { data: {} })
    );

  const mutationResult = (operation: Operation): OperationResult => {
    const next = pending.shift();
    return next?.error ? makeErrorResult(operation, next.error) : makeResult(operation, { data: next?.data ?? null });
  };

  const site: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation: Operation) => operation.kind !== 'teardown'),
      mergeMap((operation: Operation) => {
        if (operation.kind === 'mutation') return fromArray([mutationResult(operation)]);
        reached.push(operation.variables as Variables);
        if (typeof operation.context.fetch === 'function') return fromPromise(replay(operation));
        if (operation.context.requestPolicy === REFRESH_POLICY) redriven.push(operation);
        return fromArray(browseResults(operation));
      })
    );

  const siteClient = new Client({ url: GRAPHQL, exchanges: [site] });
  const guard = installInventoryGuard(win as unknown as Parameters<typeof installInventoryGuard>[0]);
  const client = new Client({ url: GRAPHQL, exchanges: [...guard.exchanges, delegateExchange(siteClient)] });
  const mount = () => guard.attach(client);
  if (mounted) mount();

  const states: PriceState[] = [];
  const rows: PriceRows[] = [];
  const scopedRows: ScopedRows[] = [];
  win.document.addEventListener(PRICE_STATE_EVENT, (event) => {
    const scoped = readPriceState(event as unknown as Event);
    if (scoped) states.push(scoped.state);
  });
  win.document.addEventListener(PRICE_ROWS_EVENT, (event) => {
    const scoped = readPriceRows(event as unknown as Event);
    if (scoped) rows.push(scoped.rows);
    if (scoped) scopedRows.push(scoped);
  });
  const browse = (variables: Variables): number => {
    pipe(
      client.query(LIST, variables),
      subscribe(() => undefined)
    );
    return keyOf(variables);
  };
  const watchList = (variables: Variables) => {
    const results: OperationResult[] = [];
    pipe(
      client.query(LIST, variables),
      subscribe((result: OperationResult) => void results.push(result))
    );
    return results;
  };
  const mutate = (name: string, variables: Variables = {}) => client.mutation(mutationDocument(name), variables).toPromise();
  const refreshed: RefreshResult[] = [];
  win.document.addEventListener(REFRESH_RESULT_EVENT, (event) => {
    const result = readRefreshResult(event as unknown as Event);
    if (result) refreshed.push(result);
  });
  const sendRefreshDetail = (detail: string) => win.document.dispatchEvent(new win.CustomEvent(REFRESH_REQUEST_EVENT, { detail } as never));
  const requestRefresh = (scope: ListScope) => sendRefreshDetail(encodeRefreshRequest(scope));
  const send = (name: string, detail: string) => win.document.dispatchEvent(new win.CustomEvent(name, { detail: detail as unknown as object }));
  const switchView = (isOn: boolean, scope: ListScope = 'grid') => send(PRICE_VIEW_EVENT, encodePriceSwitch({ scope, isOn }));
  const order = (sent: { viewId: number; revision: number; descending: number[]; ascending: number[] }, scope: ListScope = 'grid') =>
    send(PRICE_ORDER_EVENT, encodePriceOrder({ scope, order: sent }));
  return {
    win,
    client,
    queries,
    reached,
    redriven,
    log,
    fetched,
    fetchedUrls,
    states,
    rows,
    scopedRows,
    refreshed,
    requestRefresh,
    sendRefreshDetail,
    switchView,
    order,
    mount,
    browse,
    watchList,
    mutate,
  };
};

const ROUTE = '/users/u/cards';

const forgeOf = (userId: string, ranks: string[]): SiteMutation => ({ name: 'forgeCards', data: forgedData(userId, ranks) });
const acceptOf = (name: string, success = true): SiteMutation => ({ name, data: acceptedData(name, success) });

describe('planRefresh', () => {
  const families = () => {
    const record = createListRecord();
    record.record({ document: 'd', variables: splitPicker('USER:1'), options: {} }, ROUTE);
    record.record({ document: 'd', variables: profileGrid('USER:1'), options: {} }, ROUTE);
    record.record({ document: 'd', variables: splitPicker('USER:2'), options: {} }, ROUTE);
    return record.families();
  };

  it('picks, after a forge, the lists of that user that exclude a received card', () => {
    const plan = planRefresh(mutationResult('forgeCards', forgedData('USER:1', ['F'])), families());
    expect(plan.map((family) => family.filters)).toEqual([expect.objectContaining({ userId: 'USER:1', animated: false })]);
  });

  it('picks nothing when every list accepts what was received, or when the forge failed', () => {
    expect(planRefresh(mutationResult('forgeCards', forgedData('USER:1', ['C'])), families())).toEqual([]);
    expect(planRefresh(mutationResult('forgeCards', null, new Error('x')), families())).toEqual([]);
    expect(planRefresh(mutationResult('forgeCards', { forgeCards: null }), families())).toEqual([]);
  });

  it('picks every list after an accepted trade or offer, and nothing for a refusal or another operation', () => {
    expect(planRefresh(mutationResult('acceptCardTrade', acceptedData('acceptCardTrade')), families())).toHaveLength(3);
    expect(planRefresh(mutationResult('acceptCardOffer', acceptedData('acceptCardOffer')), families())).toHaveLength(3);
    expect(planRefresh(mutationResult('acceptCardTrade', acceptedData('acceptCardTrade', false)), families())).toEqual([]);
    expect(planRefresh(mutationResult('declineCardTrade', acceptedData('declineCardTrade')), families())).toEqual([]);
    expect(planRefresh(mutationResult('acceptCardTrade', {}), families())).toEqual([]);
  });
});

describe('installInventoryGuard', () => {
  it('leaves other requests exactly as they were', async () => {
    const { win, client } = rig();
    expect((await client.query(gql('query fetchViewer { viewer { id } }'), {}).toPromise()).data).toEqual({});
    await win.happyDOM.close();
  });

  it('refreshes the lists a forge got wrong, right after the result is applied, from the network', async () => {
    const { win, browse, mutate, queries } = rig({ mutations: [forgeOf('USER:1', ['F'])] });
    browse(splitPicker('USER:1'));
    browse(splitPicker('USER:1', 'c1'));
    browse(profileGrid('USER:1'));
    await mutate('forgeCards');
    await settle();
    expect(queries.map((query) => query.variables)).toEqual([splitPicker('USER:1'), splitPicker('USER:1', 'c1')]);
    expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
    await win.happyDOM.close();
  });

  it('does not touch lists that already accept what a forge delivered', async () => {
    const { win, browse, mutate, queries } = rig({ mutations: [forgeOf('USER:1', ['C'])] });
    browse(splitPicker('USER:1'));
    await mutate('forgeCards');
    await settle();
    expect(queries).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('refreshes every recorded list after an accepted trade, one list after another', async () => {
    const { win, browse, mutate, queries, log } = rig({ mutations: [acceptOf('acceptCardTrade')], slow: true });
    browse(profileGrid('USER:1'));
    browse(splitPicker('USER:2'));
    await mutate('acceptCardTrade');
    await settle();
    await settle();
    expect(queries).toHaveLength(2);
    expect(log).toEqual(['start USER:1', 'end USER:1', 'start USER:2', 'end USER:2']);
    await win.happyDOM.close();
  });

  it('does nothing when the action failed', async () => {
    const { win, browse, mutate, queries } = rig({ mutations: [acceptOf('acceptCardOffer', false)] });
    browse(profileGrid('USER:1'));
    await mutate('acceptCardOffer');
    await settle();
    expect(queries).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('queues a second action behind the first instead of overlapping refreshes', async () => {
    const { win, browse, mutate, log } = rig({ mutations: [acceptOf('acceptCardTrade'), acceptOf('acceptCardTrade')], slow: true });
    browse(profileGrid('USER:1'));
    await Promise.all([mutate('acceptCardTrade'), mutate('acceptCardTrade')]);
    await settle();
    await settle();
    expect(log).toEqual(['start USER:1', 'end USER:1', 'start USER:1', 'end USER:1']);
    await win.happyDOM.close();
  });

  describe('refreshing the open lists on request', () => {
    it('marks the document ready once the swap has handed it the clients, and not before', async () => {
      const { win, mount } = rig({ mounted: false });
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBeNull();
      mount();
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBe(GUARD_READY);
      await win.happyDOM.close();
    });

    it('replays every page of the grid lists of this route and leaves the pickers alone', async () => {
      const { win, browse, requestRefresh, refreshed, queries } = rig();
      browse(cardsGrid('USER:1'));
      browse(cardsGrid('USER:1', 'c1'));
      browse(splitPicker('USER:1'));
      requestRefresh('grid');
      await settle();
      expect(queries.map((query) => query.variables)).toEqual([cardsGrid('USER:1'), cardsGrid('USER:1', 'c1')]);
      expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
      expect(refreshed).toEqual([{ scope: 'grid', outcome: 'done' }]);
      await win.happyDOM.close();
    });

    it('replays the picker lists of this route and leaves the grid alone', async () => {
      const { win, browse, requestRefresh, refreshed, queries } = rig();
      browse(cardsGrid('USER:1'));
      browse(splitPicker('USER:1'));
      browse(splitPicker('USER:2'));
      requestRefresh('picker');
      await settle();
      await settle();
      expect(queries.map((query) => query.variables.userId)).toEqual(['USER:1', 'USER:2']);
      expect(refreshed).toEqual([{ scope: 'picker', outcome: 'done' }]);
      await win.happyDOM.close();
    });

    it('says there is nothing to refresh when the route holds no list of that kind', async () => {
      const { win, browse, requestRefresh, refreshed, queries } = rig();
      browse(splitPicker('USER:1'));
      requestRefresh('grid');
      browse(cardsGrid('USER:1'));
      win.happyDOM.setURL('https://senkuro.me/users/other/cards');
      requestRefresh('grid');
      await settle();
      expect(refreshed).toEqual([
        { scope: 'grid', outcome: 'nothing' },
        { scope: 'grid', outcome: 'nothing' },
      ]);
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('says there is nothing to refresh before the swap handed it the clients', async () => {
      const { win, requestRefresh, refreshed } = rig({ mounted: false });
      requestRefresh('picker');
      await settle();
      expect(refreshed).toEqual([{ scope: 'picker', outcome: 'nothing' }]);
      await win.happyDOM.close();
    });

    it('says the refresh failed when a page could not be fetched', async () => {
      const { win, browse, requestRefresh, refreshed } = rig({ answer: { error: new Error('429') } });
      browse(cardsGrid('USER:1'));
      requestRefresh('grid');
      await settle();
      expect(refreshed).toEqual([{ scope: 'grid', outcome: 'failed' }]);
      await win.happyDOM.close();
    });

    it('queues a request behind the refresh that is running', async () => {
      const { win, browse, requestRefresh, refreshed, log } = rig({ slow: true });
      browse(cardsGrid('USER:1'));
      requestRefresh('grid');
      requestRefresh('grid');
      await settle();
      await settle();
      await settle();
      expect(log).toEqual(['start USER:1', 'end USER:1', 'start USER:1', 'end USER:1']);
      expect(refreshed).toHaveLength(2);
      await win.happyDOM.close();
    });

    it('ignores a request it cannot read', async () => {
      const { win, browse, sendRefreshDetail, refreshed, queries } = rig();
      browse(cardsGrid('USER:1'));
      sendRefreshDetail('junk');
      sendRefreshDetail(JSON.stringify({ scope: 'all' }));
      await settle();
      expect(refreshed).toEqual([]);
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });
  });

  describe('refreshing a list the site showed from its cache', () => {
    it('refreshes every recorded page of a list when the site shows its first page from the cache', async () => {
      const { win, browse, queries } = rig({ outcomes: ['hit'] });
      browse(cardsGrid('USER:1', 'c1'));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.after)).toEqual([undefined, 'c1']);
      expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
      await win.happyDOM.close();
    });

    it('leaves a first page the network answered alone', async () => {
      const { win, browse, queries } = rig({ outcomes: ['miss'] });
      browse(cardsGrid('USER:1', 'c1'));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('leaves the first page of a list it sees for the first time alone, which is what the swap re-runs', async () => {
      const { win, browse, queries } = rig({ outcomes: ['hit'] });
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('refreshes only the list that came from the cache', async () => {
      const { win, browse, queries } = rig({ outcomes: ['hit'] });
      browse(cardsGrid('USER:2', 'c1'));
      browse(cardsGrid('USER:1', 'c1'));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.userId)).toEqual(['USER:1', 'USER:1']);
      await win.happyDOM.close();
    });

    it('does not queue a second refresh of a list while one is waiting, nor for the results that follow the first', async () => {
      const { win, browse, queries } = rig({ outcomes: ['hit', 'hit', 'hit'], slow: true });
      browse(cardsGrid('USER:1', 'c1'));
      browse(cardsGrid('USER:1'));
      browse(cardsGrid('USER:1'));
      await settle();
      await settle();
      expect(queries).toHaveLength(2);
      browse(cardsGrid('USER:1'));
      await settle();
      await settle();
      expect(queries).toHaveLength(4);
      await win.happyDOM.close();
    });

    it('leaves a list longer than the limit alone', async () => {
      const { win, browse, queries } = rig({ outcomes: ['hit'] });
      for (let page = 1; page <= AUTO_REFRESH_MAX_PAGES; page++) browse(cardsGrid('USER:1', `c${page}`));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('refreshes every page of a list that is exactly at the limit', async () => {
      const { win, browse, queries } = rig({ outcomes: ['hit'] });
      for (let page = 1; page < AUTO_REFRESH_MAX_PAGES; page++) browse(cardsGrid('USER:1', `c${page}`));
      browse(cardsGrid('USER:1'));
      await until(() => queries.length >= AUTO_REFRESH_MAX_PAGES);
      expect(queries).toHaveLength(AUTO_REFRESH_MAX_PAGES);
      await win.happyDOM.close();
    });

    it('replays a page asked with a private cursor nobody serves as the first page of the real list, never with the cursor', async () => {
      const { win, browse, queries } = rig({ outcomes: ['hit'] });
      browse(cardsGrid('USER:1', createPrivateCursor(1, 2)));
      browse(cardsGrid('USER:1', 'c1'));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.after)).toEqual([null, 'c1']);
      await win.happyDOM.close();
    });
  });

  describe('the price view', () => {
    const grid = { userId: 'USER:1', orderField: 'CREATED_AT', orderDirection: 'DESC', modifier: { include: [0] }, after: null };
    const edge = (slug: string) => ({
      __typename: 'UserCardEdge',
      node: { __typename: 'UserCard', modifier: 0, locked: false, card: { __typename: 'Card', id: `id-${slug}`, slug } },
    });
    const crawlPages = (body: string) => {
      const { operationName, variables } = JSON.parse(body) as { operationName: string; variables: { after: string | null } };
      if (operationName !== 'senkutoolsPriceRows') return page;
      const isFirst = variables.after === null;
      const edges = isFirst ? [edge('a'), edge('b'), edge('c')] : [edge('d')];
      return {
        data: {
          userCards: {
            __typename: 'UserCardConnection',
            totalCount: 4,
            edges,
            pageInfo: { __typename: 'PageInfo', hasNextPage: isFirst, endCursor: isFirst ? 'c3' : null },
          },
        },
      };
    };
    const reversed = { viewId: 1, revision: 1, descending: [3, 2, 1, 0], ascending: [0, 1, 2, 3] };
    const slugsOf = (result: OperationResult | undefined): string[] =>
      ((result?.data as { userCards?: { edges?: Row[] } } | undefined)?.userCards?.edges ?? []).map((row) => String(row.node.card?.slug));

    it('keeps the replays of the guard from becoming the list the view crawls', async () => {
      const { win, browse, switchView, states, rows, queries } = rig({ onFetch: crawlPages, outcomes: ['hit'] });
      browse({ ...grid, after: 'c1' });
      browse(grid);
      await settle();
      expect(queries.length).toBeGreaterThan(0);
      switchView(true);
      await settle();
      expect(states.at(-1)?.name).not.toBe('unavailable');
      expect(rows).toEqual([{ viewId: 1, slugs: ['a', 'b', 'c', 'd'] }]);
      await win.happyDOM.close();
    });

    it('says it is unavailable when no list was asked for, or before the swap handed it the clients', async () => {
      const first = rig();
      first.switchView(true);
      expect(first.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
      const second = rig({ onFetch: crawlPages, mounted: false });
      second.browse(grid);
      second.switchView(true);
      expect(second.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
      await first.win.happyDOM.close();
      await second.win.happyDOM.close();
    });

    it('crawls the list with its own requests to the api the client of the page uses, hands over the slugs, and answers the grid itself once the order is back', async () => {
      const { win, watchList, switchView, order, rows, states, fetched, fetchedUrls, reached } = rig({ onFetch: crawlPages });
      const results = watchList(grid);
      switchView(true);
      await settle();
      await settle();
      expect(fetched.map((body) => (JSON.parse(body) as { operationName: string }).operationName)).toEqual(['senkutoolsPriceRows', 'senkutoolsPriceRows']);
      expect(fetchedUrls).toEqual([GRAPHQL, GRAPHQL]);
      expect(rows).toEqual([{ viewId: 1, slugs: ['a', 'b', 'c', 'd'] }]);
      expect(states.at(-1)?.name).toBe('loading');
      const reachedBefore = reached.length;
      order(reversed);
      await settle();
      expect(states.at(-1)).toEqual({ name: 'ready', loaded: 4, total: 4 });
      expect(slugsOf(results.at(-1))).toEqual(['d', 'c']);
      expect((results.at(-1)?.data as { userCards: { pageInfo: { endCursor: string } } }).userCards.pageInfo.endCursor).toBe(createPrivateCursor(1, 2));
      expect(reached).toHaveLength(reachedBefore);
      await win.happyDOM.close();
    });

    it('answers what the grid asks for from the sorted list, and gives the real list back from the site when it stops', async () => {
      const { win, browse, watchList, switchView, order, redriven, reached } = rig({ onFetch: crawlPages });
      browse(grid);
      switchView(true);
      await settle();
      await settle();
      order(reversed);
      await settle();
      const reachedBefore = reached.length;
      expect(slugsOf(watchList({ ...grid, after: 'UgECAA_YJe18' }).at(-1))).toEqual(['d', 'c']);
      const later = watchList({ ...grid, after: createPrivateCursor(1, 2) });
      expect(slugsOf(later.at(-1))).toEqual(['d', 'c', 'b', 'a']);
      expect(reached).toHaveLength(reachedBefore);
      switchView(false);
      await settle();
      expect(redriven.at(-1)?.variables).toEqual({ ...grid, after: null });
      expect(later.at(-1)?.data).toEqual({});
      browse({ ...grid, after: createPrivateCursor(1, 4) });
      expect(reached.at(-1)).toEqual({ ...grid, after: null });
      await win.happyDOM.close();
    });

    it('does not record what it serves as a list of the site, so a later refresh never asks the server for it', async () => {
      const { win, browse, watchList, switchView, order, mutate, queries, reached } = rig({ onFetch: crawlPages, mutations: [acceptOf('acceptCardTrade')] });
      browse(grid);
      switchView(true);
      await settle();
      await settle();
      order(reversed);
      await settle();
      const later = watchList({ ...grid, after: createPrivateCursor(1, 2) });
      expect(slugsOf(later.at(-1))).toEqual(['d', 'c', 'b', 'a']);
      await mutate('acceptCardTrade');
      await settle();
      expect(queries.map((query) => query.variables)).toEqual([grid]);
      expect(later.at(-1)?.data).toEqual({});
      expect(reached.some((variables) => hasPrivateCursor(variables.after))).toBe(false);
      await win.happyDOM.close();
    });

    it('shows a lock of a card in the list it serves at once, from its own rows, asking the site nothing for the list', async () => {
      const lock = { input: { userId: 'USER:1', cards: [{ cardId: 'id-b', modifier: 0 }], locked: true } };
      const { win, watchList, switchView, order, mutate, reached, fetched } = rig({
        onFetch: crawlPages,
        mutations: [{ name: 'bulkUpdateUserCardLock', data: { bulkUpdateUserCardLock: { success: true } } }],
      });
      watchList(grid);
      switchView(true);
      await settle();
      await settle();
      order(reversed);
      await settle();
      const later = watchList({ ...grid, after: createPrivateCursor(1, 2) });
      const reachedBefore = reached.length;
      const fetchedBefore = fetched.length;
      await mutate('bulkUpdateUserCardLock', lock);
      await settle();
      const rowsShown = (later.at(-1)?.data as { userCards: { edges: Row[] } }).userCards.edges;
      expect(rowsShown.map((row) => [row.node.card?.slug, row.node.locked])).toEqual([
        ['d', false],
        ['c', false],
        ['b', true],
        ['a', false],
      ]);
      expect(reached).toHaveLength(reachedBefore);
      expect(fetched).toHaveLength(fetchedBefore);
      await win.happyDOM.close();
    });

    const picker = { userId: 'USER:1', orderField: 'CREATED_AT', orderDirection: 'DESC', modifier: { exclude: [] }, after: null };
    const forOrder = (viewId: number) => ({ ...reversed, viewId });

    it('keeps the profile grid and a window picker apart: each switch starts, serves and stops only its own list', async () => {
      const { win, browse, watchList, switchView, order, scopedRows, redriven, reached } = rig({ onFetch: crawlPages });
      browse(grid);
      const pickerKey = browse(picker);
      switchView(true, 'grid');
      switchView(true, 'picker');
      await until(() => scopedRows.length === 2);
      expect(scopedRows.map((sent) => sent.scope).sort()).toEqual(['grid', 'picker']);
      for (const sent of scopedRows) order(forOrder(sent.rows.viewId), sent.scope);
      await settle();
      const reachedBefore = reached.length;
      expect(slugsOf(watchList(grid).at(-1))).toEqual(['d', 'c']);
      expect(slugsOf(watchList(picker).at(-1))).toEqual(['d', 'c']);
      expect(reached).toHaveLength(reachedBefore);
      switchView(false, 'picker');
      await settle();
      expect(redriven.at(-1)?.key).toBe(pickerKey);
      expect(redriven.at(-1)?.variables).toEqual(picker);
      expect(slugsOf(watchList(grid).at(-1))).toEqual(['d', 'c']);
      await win.happyDOM.close();
    });

    it('crawls the list of a window again when the window asks for a refresh, and leaves the grid serving its own', async () => {
      const { win, browse, watchList, switchView, order, scopedRows, requestRefresh, reached } = rig({ onFetch: crawlPages });
      browse(grid);
      browse(picker);
      switchView(true, 'grid');
      switchView(true, 'picker');
      await until(() => scopedRows.length === 2);
      for (const sent of scopedRows) order(forOrder(sent.rows.viewId), sent.scope);
      await settle();
      requestRefresh('picker');
      await until(() => scopedRows.length === 3);
      expect(scopedRows.at(-1)?.scope).toBe('picker');
      browse(picker);
      expect(reached.at(-1)).toEqual(picker);
      const reachedBefore = reached.length;
      expect(slugsOf(watchList(grid).at(-1))).toEqual(['d', 'c']);
      expect(reached).toHaveLength(reachedBefore);
      requestRefresh('grid');
      await settle();
      expect(scopedRows).toHaveLength(3);
      await win.happyDOM.close();
    });

    it('sends a private cursor nobody serves to the site as the first page of the real list, never as it is', async () => {
      const { win, browse, reached } = rig();
      browse({ ...grid, after: createPrivateCursor(4, 2) });
      expect(reached.at(-1)).toEqual({ ...grid, after: null });
      await win.happyDOM.close();
    });
  });

  it('keeps the site working before the swap handed it the clients', async () => {
    const { win, client } = rig({ mounted: false });
    expect((await client.query(gql('query fetchViewer { viewer { id } }'), {}).toPromise()).data).toEqual({});
    await win.happyDOM.close();
  });
});
