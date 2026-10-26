import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';
import { make, pipe, subscribe } from 'wonka';
import type { Source } from 'wonka';
import { parse } from '@0no-co/graphql.web';

import type { MutationResult } from '../utils/inventory/client-hooks';
import { LIST_OPERATION, createListRecord, type Variables } from '../utils/inventory/list-families';
import { AUTO_REFRESH_MAX_PAGES, installInventoryGuard, planRefresh } from '../utils/inventory/inventory-guard';
import { REFRESH_POLICY } from '../utils/inventory/list-refresh';
import { privateFieldOf, createPrivateCursor } from '../utils/inventory/price-private';
import {
  GUARD_ATTRIBUTE,
  GUARD_READY,
  REFRESH_REQUEST_EVENT,
  REFRESH_RESULT_EVENT,
  encodeRefreshRequest,
  readRefreshResult,
  type RefreshResult,
  type RefreshScope,
} from '../utils/shared/refresh-signal';
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
} from '../utils/shared/price-signal';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';

const GRAPHQL = 'https://api.senkuro.me/graphql';

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

const request = (name: string, variables: Variables = {}): QueryRequest => ({
  key: 1,
  variables,
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: name } }] },
});

const received = (rank: string) => ({ modifier: 0, card: { id: `id-${rank}`, rank, animated: false, explicit: false } });

const forged = (userId: string, ranks: string[]): MutationResult => ({ data: { forgeCards: { userId, addUserCards: ranks.map(received) } } });

const accepted = (name: string, success = true): MutationResult => ({ data: { [name]: { success } } });

const withOperation = (result: MutationResult, name: string): MutationResult => ({ ...result, operation: request(name) });

const page = { data: { userCards: { pageInfo: { endCursor: 'c1', hasNextPage: false }, edges: [{ node: { modifier: 0, card: { id: 'c1' } } }] } } };

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const until = async (done: () => boolean) => {
  for (let pass = 0; pass < 200 && !done(); pass++) await settle();
};

type Init = NonNullable<Parameters<Window['fetch']>[1]>;

interface Rig {
  answer?: unknown;
  mounted?: boolean;
  results?: MutationResult[];
  slow?: boolean;
  outcomes?: string[];
  onFetch?: (body: string) => unknown;
  withRedrive?: boolean;
}

const rig = ({ answer = {}, mounted = true, results = [], slow = false, outcomes, onFetch, withRedrive = false }: Rig = {}) => {
  const win = new Window({ url: 'https://senkuro.me/forge/split' });
  win.document.body.innerHTML = '<div id="app"></div>';
  const queries: { variables: Variables; options: Record<string, unknown> }[] = [];
  const reached: Variables[] = [];
  const log: string[] = [];
  const pending = [...results];
  const client: QueryClient = {
    executeQuery: (asked) => {
      reached.push(asked.variables ?? {});
      if (!outcomes) return null;
      return make<Record<string, unknown>>((observer) => {
        outcomes.forEach((cacheOutcome) => observer.next({ data: {}, stale: false, hasNext: false, operation: { context: { meta: { cacheOutcome } } } }));
        observer.complete();
        return () => undefined;
      });
    },
    executeMutation: () =>
      make<MutationResult>((observer) => {
        const next = pending.shift();
        if (next) observer.next(next);
        observer.complete();
        return () => undefined;
      }),
    query: (_document, variables, options = {}) => ({
      toPromise: async () => {
        client.executeQuery(request(LIST_OPERATION, variables), options);
        queries.push({ variables, options });
        const index = queries.length - 1;
        log.push(`start ${String(variables.userId)}`);
        if (slow) await new Promise((resolve) => setTimeout(resolve, 15));
        if (typeof options.fetch === 'function') {
          await (options.fetch as (input: string, init: Init) => Promise<Response>)(GRAPHQL, {
            method: 'POST',
            body: JSON.stringify({ operationName: LIST_OPERATION, variables }),
          });
        }
        log.push(`end ${String(variables.userId)}`);
        return typeof answer === 'function' ? (answer as (at: number) => unknown)(index) : answer;
      },
    }),
  };
  const fetched: string[] = [];
  const fetchedUrls: string[] = [];
  win.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    fetched.push(body);
    fetchedUrls.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
    return Promise.resolve(new Response(JSON.stringify(onFetch ? onFetch(body) : page)));
  }) as unknown as typeof win.fetch;
  const reexecuted: { requested: QueryRequest; options: Record<string, unknown> }[] = [];
  if (withRedrive) {
    client.createRequestOperation = (_kind, requested, options = {}) => ({ requested, options, context: { url: GRAPHQL } });
    client.reexecuteOperation = (operation) => void reexecuted.push(operation as { requested: QueryRequest; options: Record<string, unknown> });
  }
  const states: PriceState[] = [];
  const rows: PriceRows[] = [];
  win.document.addEventListener(PRICE_STATE_EVENT, (event) => {
    const state = readPriceState(event as unknown as Event);
    if (state) states.push(state);
  });
  win.document.addEventListener(PRICE_ROWS_EVENT, (event) => {
    const sent = readPriceRows(event as unknown as Event);
    if (sent) rows.push(sent);
  });
  const mount = () => {
    (win.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: { value: client } } } };
  };
  if (mounted) mount();
  installInventoryGuard(win as unknown as Parameters<typeof installInventoryGuard>[0]);
  const respond = () => win.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: 'fetchViewer' }) });
  const browse = (variables: Variables, options?: Record<string, unknown>, asked: QueryRequest = request(LIST_OPERATION, variables)) => {
    const source = client.executeQuery(asked, options);
    if (typeof source === 'function')
      pipe(
        source as Source<unknown>,
        subscribe(() => undefined)
      );
    return source;
  };
  const mutate = (name: string) => (client.executeMutation(request(name)) as { toPromise(): Promise<MutationResult> }).toPromise();
  const refreshed: RefreshResult[] = [];
  win.document.addEventListener(REFRESH_RESULT_EVENT, (event) => {
    const result = readRefreshResult(event as unknown as Event);
    if (result) refreshed.push(result);
  });
  const sendRefreshDetail = (detail: string) => win.document.dispatchEvent(new win.CustomEvent(REFRESH_REQUEST_EVENT, { detail } as never));
  const requestRefresh = (scope: RefreshScope) => sendRefreshDetail(encodeRefreshRequest(scope));
  const send = (name: string, detail: string) => win.document.dispatchEvent(new win.CustomEvent(name, { detail: detail as unknown as object }));
  const switchView = (isOn: boolean) => send(PRICE_VIEW_EVENT, encodePriceSwitch(isOn));
  const order = (sent: { viewId: number; revision: number; descending: number[]; ascending: number[] }) => send(PRICE_ORDER_EVENT, encodePriceOrder(sent));
  const browseList = (asked: QueryRequest) => client.executeQuery(asked);
  return {
    win,
    queries,
    reached,
    log,
    fetched,
    fetchedUrls,
    reexecuted,
    states,
    rows,
    refreshed,
    requestRefresh,
    sendRefreshDetail,
    switchView,
    order,
    browseList,
    mount,
    respond,
    browse,
    mutate,
  };
};

const ROUTE = '/users/u/cards';

describe('planRefresh', () => {
  const families = () => {
    const record = createListRecord();
    record.record({ document: 'd', variables: splitPicker('USER:1'), options: {} }, ROUTE);
    record.record({ document: 'd', variables: profileGrid('USER:1'), options: {} }, ROUTE);
    record.record({ document: 'd', variables: splitPicker('USER:2'), options: {} }, ROUTE);
    return record.families();
  };

  it('picks, after a forge, the lists of that user that exclude a received card', () => {
    const plan = planRefresh(withOperation(forged('USER:1', ['F']), 'forgeCards'), families());
    expect(plan.map((family) => family.filters)).toEqual([expect.objectContaining({ userId: 'USER:1', animated: false })]);
  });

  it('picks nothing when every list accepts what was received, or when the forge failed', () => {
    expect(planRefresh(withOperation(forged('USER:1', ['C']), 'forgeCards'), families())).toEqual([]);
    expect(planRefresh({ ...withOperation(forged('USER:1', ['F']), 'forgeCards'), error: new Error('x') }, families())).toEqual([]);
    expect(planRefresh({ operation: request('forgeCards'), data: { forgeCards: null } }, families())).toEqual([]);
  });

  it('picks every list after an accepted trade or offer, and nothing for a refusal or another operation', () => {
    expect(planRefresh(withOperation(accepted('acceptCardTrade'), 'acceptCardTrade'), families())).toHaveLength(3);
    expect(planRefresh(withOperation(accepted('acceptCardOffer'), 'acceptCardOffer'), families())).toHaveLength(3);
    expect(planRefresh(withOperation(accepted('acceptCardTrade', false), 'acceptCardTrade'), families())).toEqual([]);
    expect(planRefresh(withOperation(accepted('declineCardTrade'), 'declineCardTrade'), families())).toEqual([]);
    expect(planRefresh({ data: {} }, families())).toEqual([]);
  });
});

describe('installInventoryGuard', () => {
  it('leaves other requests exactly as they were', async () => {
    const { win, respond } = rig();
    expect(await (await respond()).json()).toEqual(page);
    await win.happyDOM.close();
  });

  it('attaches on the first response after the app has mounted, so only lists opened afterwards are recorded', async () => {
    const { win, mount, respond, browse, mutate, queries } = rig({ mounted: false, results: [withOperation(forged('USER:1', ['F']), 'forgeCards')] });
    await respond();
    mount();
    browse(splitPicker('USER:1'));
    await respond();
    browse(splitPicker('USER:1', 'c1'));
    await mutate('forgeCards');
    await settle();
    expect(queries.map((query) => query.variables.after)).toEqual([undefined, 'c1']);
    await win.happyDOM.close();
  });

  it('refreshes the lists a forge got wrong, right after the result is applied, from the network', async () => {
    const { win, respond, browse, mutate, queries } = rig({ results: [withOperation(forged('USER:1', ['F']), 'forgeCards')] });
    await respond();
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
    const { win, respond, browse, mutate, queries } = rig({ results: [withOperation(forged('USER:1', ['C']), 'forgeCards')] });
    await respond();
    browse(splitPicker('USER:1'));
    await mutate('forgeCards');
    await settle();
    expect(queries).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('refreshes every recorded list after an accepted trade, one list after another', async () => {
    const { win, respond, browse, mutate, queries, log } = rig({ results: [withOperation(accepted('acceptCardTrade'), 'acceptCardTrade')], slow: true });
    await respond();
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
    const { win, respond, browse, mutate, queries } = rig({ results: [withOperation(accepted('acceptCardOffer', false), 'acceptCardOffer')] });
    await respond();
    browse(profileGrid('USER:1'));
    await mutate('acceptCardOffer');
    await settle();
    expect(queries).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('queues a second action behind the first instead of overlapping refreshes', async () => {
    const result = withOperation(accepted('acceptCardTrade'), 'acceptCardTrade');
    const { win, respond, browse, mutate, log } = rig({ results: [result, result], slow: true });
    await respond();
    browse(profileGrid('USER:1'));
    await Promise.all([mutate('acceptCardTrade'), mutate('acceptCardTrade')]);
    await settle();
    await settle();
    expect(log).toEqual(['start USER:1', 'end USER:1', 'start USER:1', 'end USER:1']);
    await win.happyDOM.close();
  });

  it('knows the cursors the site was given before its client was found, from the answers on the wire', async () => {
    const { win, mount, respond, browse, reached } = rig({ mounted: false });
    const cards = { userId: 'USER:1', modifier: { include: [0] } };
    await win.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: LIST_OPERATION, variables: cards }) });
    mount();
    await respond();
    browse({ userId: 'USER:1', modifier: { include: [1] }, after: 'c1' });
    browse({ ...cards, after: 'c1' });
    expect(reached.map((variables) => variables.after)).toEqual([null, 'c1']);
    await win.happyDOM.close();
  });

  describe('refreshing the open lists on request', () => {
    it('marks the document ready once it has found the client, and not before', async () => {
      const { win, mount, respond } = rig({ mounted: false });
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBeNull();
      await respond();
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBeNull();
      mount();
      await respond();
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBe(GUARD_READY);
      await win.happyDOM.close();
    });

    it('replays every page of the grid lists of this route and leaves the pickers alone', async () => {
      const { win, respond, browse, requestRefresh, refreshed, queries } = rig();
      await respond();
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
      const { win, respond, browse, requestRefresh, refreshed, queries } = rig();
      await respond();
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
      const { win, respond, browse, requestRefresh, refreshed, queries } = rig();
      await respond();
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

    it('says there is nothing to refresh before the client was found', async () => {
      const { win, requestRefresh, refreshed } = rig({ mounted: false });
      requestRefresh('picker');
      await settle();
      expect(refreshed).toEqual([{ scope: 'picker', outcome: 'nothing' }]);
      await win.happyDOM.close();
    });

    it('says the refresh failed when a page could not be fetched', async () => {
      const { win, respond, browse, requestRefresh, refreshed } = rig({ answer: { error: new Error('429') } });
      await respond();
      browse(cardsGrid('USER:1'));
      requestRefresh('grid');
      await settle();
      expect(refreshed).toEqual([{ scope: 'grid', outcome: 'failed' }]);
      await win.happyDOM.close();
    });

    it('queues a request behind the refresh that is running', async () => {
      const { win, respond, browse, requestRefresh, refreshed, log } = rig({ slow: true });
      await respond();
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
      const { win, respond, browse, sendRefreshDetail, refreshed, queries } = rig();
      await respond();
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
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      browse(cardsGrid('USER:1', 'c1'));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.after)).toEqual([undefined, 'c1']);
      expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
      await win.happyDOM.close();
    });

    it('leaves a first page the network answered alone', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['miss'] });
      await respond();
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('refreshes only the list that came from the cache', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      browse(cardsGrid('USER:2'));
      await settle();
      queries.length = 0;
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.userId)).toEqual(['USER:1']);
      await win.happyDOM.close();
    });

    it('does not queue a second refresh of a list while one is waiting, nor for the results that follow the first', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit', 'hit', 'hit'], slow: true });
      await respond();
      browse(cardsGrid('USER:1'));
      browse(cardsGrid('USER:1'));
      await settle();
      await settle();
      expect(queries).toHaveLength(1);
      browse(cardsGrid('USER:1'));
      await settle();
      await settle();
      expect(queries).toHaveLength(2);
      await win.happyDOM.close();
    });

    it('leaves a list longer than the limit alone', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      for (let page = 1; page <= AUTO_REFRESH_MAX_PAGES; page++) browse(cardsGrid('USER:1', `c${page}`));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('refreshes every page of a list that is exactly at the limit', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      for (let page = 1; page < AUTO_REFRESH_MAX_PAGES; page++) browse(cardsGrid('USER:1', `c${page}`));
      browse(cardsGrid('USER:1'));
      await until(() => queries.length >= AUTO_REFRESH_MAX_PAGES);
      expect(queries).toHaveLength(AUTO_REFRESH_MAX_PAGES);
      await win.happyDOM.close();
    });

    it('leaves the private list of the price view alone, so a replay never asks the server for it', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      browse({ ...cardsGrid('USER:1'), orderField: privateFieldOf(1) });
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });
  });

  describe('the price view', () => {
    const DOCUMENT = parse(
      'query fetchUserCards($after: String, $userId: ID!, $orderField: UserCardOrderField, $orderDirection: OrderDirection) { userCards(first: 2, after: $after, userId: $userId, orderBy: { field: $orderField, direction: $orderDirection }) { edges { node { modifier card { id slug } } } pageInfo { hasNextPage endCursor } } }'
    );
    const grid = { userId: 'USER:1', orderField: 'CREATED_AT', orderDirection: 'DESC', modifier: { include: [0] }, after: null };
    const listRequest = (variables: Variables = grid, key = 7): QueryRequest => ({ key, variables, query: DOCUMENT as unknown as QueryRequest['query'] });
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

    it('keeps the replays of the guard from becoming the list the view crawls', async () => {
      const { win, respond, browse, switchView, states, rows } = rig({ onFetch: crawlPages, withRedrive: true, outcomes: ['hit'] });
      await respond();
      browse(grid, undefined, listRequest());
      await settle();
      switchView(true);
      await settle();
      expect(states.at(-1)?.name).not.toBe('unavailable');
      expect(rows).toEqual([{ viewId: 1, slugs: ['a', 'b', 'c', 'd'] }]);
      await win.happyDOM.close();
    });

    it('gives the real list back with the cursor the guard repaired, not the foreign one it dropped', async () => {
      const { win, respond, browseList, switchView, order, reexecuted, reached } = rig({ onFetch: crawlPages, withRedrive: true });
      await respond();
      await win.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: LIST_OPERATION, variables: grid }) });
      browseList(listRequest({ ...grid, modifier: { include: [1] }, after: 'c1' }));
      expect(reached.at(-1)?.after).toBeNull();
      switchView(true);
      await settle();
      order(reversed);
      switchView(false);
      expect(reexecuted.at(-1)?.requested.variables?.after ?? null).toBeNull();
      await win.happyDOM.close();
    });

    it('says it is unavailable when no list was asked for, or the client cannot ask again', async () => {
      const first = rig({ withRedrive: true });
      await first.respond();
      first.switchView(true);
      expect(first.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
      const second = rig({ onFetch: crawlPages });
      await second.respond();
      second.browseList(listRequest());
      second.switchView(true);
      expect(second.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
      await first.win.happyDOM.close();
      await second.win.happyDOM.close();
    });

    it('crawls the list with its own requests to the api the site uses, hands over the slugs, and serves the sorted list once the order is back', async () => {
      const { win, respond, browseList, switchView, order, rows, states, fetched, fetchedUrls, reexecuted } = rig({ onFetch: crawlPages, withRedrive: true });
      await respond();
      browseList(listRequest());
      switchView(true);
      await settle();
      await settle();
      expect(fetched.slice(1).map((body) => (JSON.parse(body) as { operationName: string }).operationName)).toEqual([
        'senkutoolsPriceRows',
        'senkutoolsPriceRows',
      ]);
      expect(fetchedUrls.slice(1)).toEqual([GRAPHQL, GRAPHQL]);
      expect(rows).toEqual([{ viewId: 1, slugs: ['a', 'b', 'c', 'd'] }]);
      expect(states.at(-1)?.name).toBe('loading');
      order(reversed);
      expect(states.at(-1)).toEqual({ name: 'ready', loaded: 4, total: 4 });
      expect(reexecuted).toHaveLength(1);
      expect(reexecuted[0]?.requested.key).toBe(7);
      expect(reexecuted[0]?.requested.variables).toEqual({ ...grid, orderField: privateFieldOf(1) });
      expect(reexecuted[0]?.options.requestPolicy).toBe('network-only');
      const before = fetched.length;
      const response = await win.fetch(GRAPHQL, {
        method: 'POST',
        body: JSON.stringify({ operationName: LIST_OPERATION, variables: { ...grid, orderField: privateFieldOf(1) } }),
      });
      const answer = (await response.json()) as unknown as {
        data: { userCards: { edges: { node: { card: { slug: string } } }[]; pageInfo: { endCursor: string } } };
      };
      expect(answer.data.userCards.edges.map((row) => row.node.card.slug)).toEqual(['d', 'c']);
      expect(answer.data.userCards.pageInfo.endCursor).toBe(createPrivateCursor(1, 2));
      expect(fetched).toHaveLength(before);
      await win.happyDOM.close();
    });

    it('rewrites what the grid asks for into the sorted list, and gives the real list back when it stops', async () => {
      const { win, respond, browseList, switchView, order, reexecuted, reached } = rig({ onFetch: crawlPages, withRedrive: true });
      await respond();
      browseList(listRequest());
      switchView(true);
      await settle();
      await settle();
      order(reversed);
      browseList(listRequest({ ...grid, after: 'UgECAA_YJe18' }));
      expect(reached.at(-1)).toEqual({ ...grid, orderField: privateFieldOf(1), after: null });
      browseList(listRequest({ ...grid, after: createPrivateCursor(1, 2) }, 9));
      switchView(false);
      expect(reexecuted).toHaveLength(2);
      expect(reexecuted[1]?.requested.variables).toEqual({ ...grid, after: null });
      expect(reexecuted[1]?.requested.key).toBe(9);
      browseList(listRequest({ ...grid, after: createPrivateCursor(1, 2) }));
      expect(reached.at(-1)).toEqual({ ...grid, after: null });
      await win.happyDOM.close();
    });

    it('does not record what it serves as a list of the site, so a later refresh never asks the server for it', async () => {
      const { win, respond, browseList, switchView, order, mutate, queries, reexecuted } = rig({
        onFetch: crawlPages,
        withRedrive: true,
        results: [withOperation(accepted('acceptCardTrade'), 'acceptCardTrade')],
      });
      await respond();
      browseList(listRequest());
      switchView(true);
      await settle();
      await settle();
      order(reversed);
      browseList(listRequest({ ...grid, orderField: privateFieldOf(1) }));
      await mutate('acceptCardTrade');
      await settle();
      expect(queries.map((query) => query.variables)).toEqual([grid]);
      expect(reexecuted).toHaveLength(2);
      await win.happyDOM.close();
    });

    it('writes the served page of a locked card again through the client, from the network, answered by the page itself', async () => {
      const lockMutation: MutationResult = {
        operation: request('bulkUpdateUserCardLock', { input: { userId: 'USER:1', cards: [{ cardId: 'id-b', modifier: 0 }], locked: true } }),
        data: { bulkUpdateUserCardLock: { success: true } },
      };
      const { win, respond, browseList, switchView, order, mutate, queries, fetched } = rig({
        onFetch: crawlPages,
        withRedrive: true,
        results: [lockMutation],
      });
      await respond();
      browseList(listRequest());
      switchView(true);
      await settle();
      await settle();
      order(reversed);
      await win.fetch(GRAPHQL, {
        method: 'POST',
        body: JSON.stringify({ operationName: LIST_OPERATION, variables: { ...grid, orderField: privateFieldOf(1), after: createPrivateCursor(1, 2) } }),
      });
      const before = fetched.length;
      await mutate('bulkUpdateUserCardLock');
      await settle();
      expect(queries).toHaveLength(1);
      expect(queries[0]?.variables).toEqual({ ...grid, orderField: privateFieldOf(1), orderDirection: 'DESC', after: createPrivateCursor(1, 2) });
      expect(queries[0]?.options.requestPolicy).toBe('network-only');
      expect(fetched).toHaveLength(before);
      await win.happyDOM.close();
    });

    it('answers an empty page for the private name when nothing is served, and never lets it reach the network', async () => {
      const { win, respond, fetched } = rig({ withRedrive: true });
      await respond();
      const before = fetched.length;
      const response = await win.fetch(GRAPHQL, {
        method: 'POST',
        body: JSON.stringify({ operationName: LIST_OPERATION, variables: { ...grid, orderField: privateFieldOf(4) } }),
      });
      expect(((await response.json()) as unknown as { data: { userCards: { edges: unknown[] } } }).data.userCards.edges).toEqual([]);
      expect(fetched).toHaveLength(before);
      await win.happyDOM.close();
    });
  });

  it('keeps working when the site client cannot be found', async () => {
    const { win, respond } = rig({ mounted: false });
    expect((await respond()).status).toBe(200);
    expect((await respond()).status).toBe(200);
    await win.happyDOM.close();
  });
});
