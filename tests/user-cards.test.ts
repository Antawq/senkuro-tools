import { describe, expect, it } from 'vitest';

import type { Transport } from '../utils/graphql';
import {
  DEEP_THROTTLE_PAGES,
  DEEP_THROTTLED_DELAY_MS,
  FAST_DELAY_MS,
  FAST_PAGES,
  MAX_PAGES,
  PAGE_SIZE,
  RATE_LIMIT_COOLDOWN_MS,
  THROTTLED_DELAY_MS,
  delayForPage,
  fetchUserCards,
  packCards,
  unpackCards,
} from '../utils/user-cards';

interface Sent {
  operationName: string;
  variables: Record<string, unknown>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const node = (slug: string, quantity: number, shard = false) => ({ node: { quantity, shard, card: { slug } } });

const page = (edges: unknown[], next: string | null) => ({ data: { userCards: { pageInfo: { hasNextPage: next !== null, endCursor: next }, edges } } });

const bodyOf = (init?: RequestInit): string => (typeof init?.body === 'string' ? init.body : '{}');

const serve = (answer: (sent: Sent, index: number) => Response) => {
  const sent: Sent[] = [];
  const sleeps: number[] = [];
  const transport: Transport = {
    fetch: (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(bodyOf(init)) as Sent;
      sent.push(body);
      return Promise.resolve(answer(body, sent.length - 1));
    },
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
  };
  return { sent, sleeps, transport };
};

describe('fetchUserCards', () => {
  it('walks every page of the inventory by its cursor', async () => {
    const pages: Record<string, unknown> = {
      first: page([node('a-a', 2), node('b-b', 1)], 'c1'),
      c1: page([node('c-c', 5)], 'c2'),
      c2: page([node('d-d', 1, true)], null),
    };
    const { sent, transport } = serve((request) => json(pages[(request.variables.after as string | null) ?? 'first']));
    const progress: number[] = [];
    const cards = await fetchUserCards(null, 'user-1', (loaded) => progress.push(loaded), transport);
    expect(cards).toEqual([
      { slug: 'a-a', quantity: 2, shard: false },
      { slug: 'b-b', quantity: 1, shard: false },
      { slug: 'c-c', quantity: 5, shard: false },
      { slug: 'd-d', quantity: 1, shard: true },
    ]);
    expect(progress).toEqual([2, 3, 4]);
    expect(sent.map((request) => request.operationName)).toEqual(['UserCards', 'UserCards', 'UserCards']);
    expect(sent.map((request) => request.variables)).toEqual([
      { userId: 'user-1', first: PAGE_SIZE, after: null, orderBy: { field: 'CREATED_AT', direction: 'ASC' } },
      { userId: 'user-1', first: PAGE_SIZE, after: 'c1', orderBy: { field: 'CREATED_AT', direction: 'ASC' } },
      { userId: 'user-1', first: PAGE_SIZE, after: 'c2', orderBy: { field: 'CREATED_AT', direction: 'ASC' } },
    ]);
  });

  it('asks only for the fields it uses', async () => {
    const queries: string[] = [];
    const transport: Transport = {
      fetch: (_url: RequestInfo | URL, init?: RequestInit) => {
        queries.push((JSON.parse(bodyOf(init)) as { query: string }).query);
        return Promise.resolve(json(page([], null)));
      },
      sleep: () => Promise.resolve(),
      random: () => 0,
    };
    await fetchUserCards(null, 'user-1', undefined, transport);
    expect(queries[0]).toContain('edges { node { quantity shard card { slug } } }');
    expect(queries[0]).not.toMatch(/image|titles|locked|modifier/);
  });

  it('skips entries it cannot use and keeps the shard flag', async () => {
    const edges = [
      null,
      { node: null },
      { node: { quantity: 1, shard: false, card: null } },
      { node: { quantity: 1, shard: false, card: { slug: '' } } },
      node('zero', 0),
      node('negative', -3),
      { node: { quantity: '4', shard: false, card: { slug: 'text-quantity' } } },
      node('kept', 3),
      node('piece', 2, true),
      { node: { quantity: 1, card: { slug: 'no-flag' } } },
    ];
    const { transport } = serve(() => json(page(edges, null)));
    expect(await fetchUserCards(null, 'user-1', undefined, transport)).toEqual([
      { slug: 'kept', quantity: 3, shard: false },
      { slug: 'piece', quantity: 2, shard: true },
      { slug: 'no-flag', quantity: 1, shard: false },
    ]);
  });

  it('answers an empty list for an empty or missing inventory', async () => {
    const empty = serve(() => json(page([], null)));
    expect(await fetchUserCards(null, 'user-1', undefined, empty.transport)).toEqual([]);
    const missing = serve(() => json({ data: { userCards: null } }));
    expect(await fetchUserCards(null, 'user-1', undefined, missing.transport)).toEqual([]);
  });

  it('stops when a page claims there is more but gives no cursor', async () => {
    const { sent, transport } = serve(() => json({ data: { userCards: { pageInfo: { hasNextPage: true, endCursor: null }, edges: [node('a-a', 1)] } } }));
    expect(await fetchUserCards(null, 'user-1', undefined, transport)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('gives up instead of walking pages for ever', async () => {
    let cursor = 0;
    const { sent, transport } = serve(() => json(page([node('a-a', 1)], `c${++cursor}`)));
    const error = await fetchUserCards(null, 'user-1', undefined, transport).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ failure: 'limit' });
    expect(sent).toHaveLength(MAX_PAGES);
  });

  it('passes an api failure on', async () => {
    const { transport } = serve(() => json({}, 503));
    expect(await fetchUserCards(null, 'user-1', undefined, transport).catch((thrown: unknown) => thrown)).toMatchObject({ failure: 'http', status: 503 });
  });

  it('stops and rejects when aborted via signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport, sent } = serve(() => json(page([node('a-a', 1)], null)));
    const error = await fetchUserCards(null, 'user-1', undefined, transport, controller.signal).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ failure: 'network' });
    expect(sent).toHaveLength(0);
  });

  it('delays requests progressively based on page index', () => {
    expect(delayForPage(0)).toBe(FAST_DELAY_MS);
    expect(delayForPage(FAST_PAGES - 1)).toBe(FAST_DELAY_MS);
    expect(delayForPage(FAST_PAGES)).toBe(THROTTLED_DELAY_MS);
    expect(delayForPage(DEEP_THROTTLE_PAGES - 1)).toBe(THROTTLED_DELAY_MS);
    expect(delayForPage(DEEP_THROTTLE_PAGES)).toBe(DEEP_THROTTLED_DELAY_MS);
    expect(delayForPage(150)).toBe(DEEP_THROTTLED_DELAY_MS);
  });

  it('does not sleep between pages during the fast first 1,000 cards', async () => {
    const pages: Record<string, unknown> = {
      first: page([node('a-a', 1)], 'c1'),
      c1: page([node('b-b', 1)], null),
    };
    const { transport, sleeps } = serve((req) => json(pages[(req.variables.after as string | null) ?? 'first']));
    const cards = await fetchUserCards(null, 'user-1', undefined, transport);
    expect(cards).toHaveLength(2);
    expect(sleeps).toEqual([]);
  });

  it('retries and recovers when hitting rate limit 429', async () => {
    let call = 0;
    const { transport, sleeps } = serve(() => {
      call++;
      if (call === 1) return json({}, 429, { 'retry-after': '10' });
      return json(page([node('a-a', 1)], null));
    });
    const cards = await fetchUserCards(null, 'user-1', undefined, transport);
    expect(cards).toEqual([{ slug: 'a-a', quantity: 1, shard: false }]);
    expect(call).toBe(2);
    expect(sleeps).toContain(RATE_LIMIT_COOLDOWN_MS);
  });
});

describe('packed cards', () => {
  const cards = [
    { slug: 'a-a', quantity: 2, shard: false },
    { slug: 'b-b', quantity: 1, shard: true },
  ];

  it('stores every card as a short row', () => {
    expect(packCards(cards)).toEqual([
      ['a-a', 2, 0],
      ['b-b', 1, 1],
    ]);
  });

  it('reads back what it stored', () => {
    expect(unpackCards(JSON.parse(JSON.stringify(packCards(cards))))).toEqual(cards);
  });

  it('survives damaged data by dropping what it cannot read', () => {
    expect(unpackCards([['ok', 3, 0], 'junk', ['bad', '1', 0], ['flag', 1, 5], null, ['piece', 2, 1]])).toEqual([
      { slug: 'ok', quantity: 3, shard: false },
      { slug: 'piece', quantity: 2, shard: true },
    ]);
    expect(unpackCards('garbage')).toEqual([]);
  });
});
