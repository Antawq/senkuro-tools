import { describe, expect, it } from 'vitest';

import { FAST_PAGES, THROTTLED_DELAY_MS, delayForPage } from '../utils/shared/paging';
import type { QueryClient } from '../utils/shared/urql-client';
import { createListRecord, type Family, type PageRequest, type Variables } from '../utils/inventory/list-families';
import { MAX_FILL_ROUNDS, REFRESH_POLICY, refreshFamilies, type RefreshEnv } from '../utils/inventory/list-refresh';

const PAGE_SIZE = 2;

type Answer = (variables: Variables) => unknown;

const listAnswer =
  (items: () => number[]): Answer =>
  (variables) => {
    const after = typeof variables.after === 'string' ? Number(variables.after) : Number.POSITIVE_INFINITY;
    const page = items()
      .filter((seq) => seq < after)
      .slice(0, PAGE_SIZE + 1);
    const shown = page.slice(0, PAGE_SIZE);
    return {
      data: {
        userCards: {
          pageInfo: { endCursor: shown.length ? String(shown.at(-1)) : null, hasNextPage: page.length > PAGE_SIZE },
          edges: shown.map((seq) => ({ node: { modifier: 0, card: { id: `s${seq}` } } })),
        },
      },
    };
  };

interface Query {
  variables: Variables;
  options: Record<string, unknown>;
}

const setup = ({
  items,
  answer,
  failFor,
  twoAnswers = false,
}: { items?: number[]; answer?: Answer; failFor?: (variables: Variables) => boolean; twoAnswers?: boolean } = {}) => {
  let list = items ?? [10, 9, 8, 7, 6, 5, 4, 3];
  const queries: Query[] = [];
  const order: string[] = [];
  const flight = { now: 0, max: 0 };
  const serve = answer ?? listAnswer(() => list);
  const record = createListRecord();
  const silent = new WeakSet<object>();
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { variables } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { variables: Variables };
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (variables.hash) return new Response(JSON.stringify({ errors: [{ message: 'PersistedQueryNotFound' }] }));
    return new Response(JSON.stringify(serve(variables)));
  };
  const client = {
    query: (_document: unknown, variables: Variables, options: Record<string, unknown> = {}) => ({
      toPromise: async () => {
        queries.push({ variables, options });
        order.push(`start ${String(variables.userId)}`);
        flight.now += 1;
        flight.max = Math.max(flight.max, flight.now);
        const send = options.fetch as typeof fetcher;
        if (twoAnswers) await send('graphql', { body: JSON.stringify({ variables: { hash: true } }) }).catch(() => undefined);
        await send('graphql', { body: JSON.stringify({ variables }) });
        flight.now -= 1;
        order.push(`end ${String(variables.userId)}`);
        return failFor?.(variables) ? { error: new Error('429') } : {};
      },
    }),
    executeQuery: () => null,
    executeMutation: () => null,
  } as unknown as QueryClient;
  const sleeps: number[] = [];
  const sleep = (delayMs: number) => {
    sleeps.push(delayMs);
    return Promise.resolve();
  };
  const env: RefreshEnv = { client, fetch: fetcher, silent, record, sleep };
  return { env, queries, order, flight, sleeps, record, setItems: (next: number[]) => (list = next) };
};

const ROUTE = '/users/u/cards';

const page = (variables: Variables, options: Record<string, unknown> = {}): PageRequest => ({ document: 'doc', variables, options });

const recordPages = (record: ReturnType<typeof createListRecord>, pages: PageRequest[]) => {
  pages.forEach((entry) => record.record(entry, ROUTE));
  return record.families()[0] as Family;
};

describe('refreshFamilies', () => {
  it('replays every recorded page of a family from the network, with its own options, in parallel', async () => {
    const { env, queries, record, flight } = setup();
    const family = recordPages(record, [
      page({ userId: 'A' }, { suspense: true }),
      page({ userId: 'A', after: '9' }, { suspense: true }),
      page({ userId: 'A', after: '7' }, { suspense: true }),
    ]);
    const report = await refreshFamilies(env, [family]);
    expect(report).toEqual({ requests: 3, failed: false });
    expect(queries.map((query) => query.variables.after)).toEqual([undefined, '9', '7']);
    expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY && query.options.suspense === true)).toBe(true);
    expect(flight.max).toBe(3);
  });

  it('sends the first pages together and the rest one at a time, paced like the loader', async () => {
    const empty = () => ({ data: { userCards: { pageInfo: { endCursor: null, hasNextPage: false }, edges: [] } } });
    const { env, queries, flight, sleeps, record } = setup({ answer: empty });
    const pages = [page({ userId: 'A' }), ...Array.from({ length: FAST_PAGES + 2 }, (_unused, index) => page({ userId: 'A', after: `c${index}` }))];
    const family = recordPages(record, pages);
    const report = await refreshFamilies(env, [family]);
    expect(report).toEqual({ requests: FAST_PAGES + 3, failed: false });
    expect(queries.map((query) => query.variables.after)).toEqual([undefined, ...pages.slice(1).map((entry) => entry.variables.after)]);
    expect(flight.max).toBe(FAST_PAGES);
    expect(sleeps).toEqual([delayForPage(FAST_PAGES), delayForPage(FAST_PAGES + 1), delayForPage(FAST_PAGES + 2)]);
    expect(sleeps.every((delayMs) => delayMs === THROTTLED_DELAY_MS)).toBe(true);
  });

  it('marks its replays silent so the recorder never sees them', async () => {
    const { env, queries, record } = setup();
    const family = recordPages(record, [page({ userId: 'A' })]);
    await refreshFamilies(env, [family]);
    expect(env.silent.has(queries[0]?.options.fetch as object)).toBe(true);
  });

  it('adds nothing when the pages still chain', async () => {
    const { env, record } = setup();
    const family = recordPages(record, [page({ userId: 'A' }), page({ userId: 'A', after: '9' }), page({ userId: 'A', after: '7' })]);
    const report = await refreshFamilies(env, [family]);
    expect(report.requests).toBe(3);
    expect(family.pages).toHaveLength(3);
  });

  it('fills the hole that opens when cards are added at the top and keeps the page order', async () => {
    const { env, queries, record, setItems } = setup();
    const family = recordPages(record, [page({ userId: 'A' }), page({ userId: 'A', after: '9' }), page({ userId: 'A', after: '7' })]);
    setItems([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    const report = await refreshFamilies(env, [family]);
    expect(report).toEqual({ requests: 4, failed: false });
    expect(queries.at(-1)?.variables).toEqual({ userId: 'A', after: '11' });
    expect(family.pages.map((entry) => entry.variables.after)).toEqual([undefined, '11', '9', '7']);
  });

  it('needs several fill rounds when many cards arrive, and stops at the cap if the chain never meets', async () => {
    const many = setup();
    const family = recordPages(many.record, [page({ userId: 'A' }), page({ userId: 'A', after: '9' })]);
    many.setItems([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
    const report = await refreshFamilies(many.env, [family]);
    expect(report.failed).toBe(false);
    expect(family.pages.map((entry) => entry.variables.after)).toEqual([undefined, '19', '17', '15', '13', '11', '9']);
    let counter = 0;
    const endless = setup({
      answer: () => ({
        data: {
          userCards: { pageInfo: { endCursor: `e${(counter += 1)}`, hasNextPage: true }, edges: [{ node: { modifier: 0, card: { id: `n${counter}` } } }] },
        },
      }),
    });
    const endlessFamily = recordPages(endless.record, [page({ userId: 'A' }), page({ userId: 'A', after: 'old' })]);
    const capped = await refreshFamilies(endless.env, [endlessFamily]);
    expect(capped.requests).toBe(2 + MAX_FILL_ROUNDS);
  });

  it('refreshes one family after another and stops everything on the first failure', async () => {
    const { env, queries, order, record } = setup({ failFor: (variables) => variables.userId === 'B' });
    const first = page({ userId: 'A' });
    const second = page({ userId: 'B' });
    const third = page({ userId: 'C' });
    [first, second, third].forEach((entry) => record.record(entry, ROUTE));
    const report = await refreshFamilies(env, record.families());
    expect(report).toEqual({ requests: 2, failed: true });
    expect(queries.map((query) => query.variables.userId)).toEqual(['A', 'B']);
    expect(order).toEqual(['start A', 'end A', 'start B', 'end B']);
  });

  it('treats a rejected request as a failure too', async () => {
    const { env, record } = setup();
    env.fetch = () => Promise.reject(new TypeError('offline'));
    const family = recordPages(record, [page({ userId: 'A' })]);
    expect((await refreshFamilies(env, [family])).failed).toBe(true);
  });

  it('keeps the answer that carries the list when a query is answered more than once', async () => {
    const { env, record, setItems } = setup({ twoAnswers: true });
    const family = recordPages(record, [page({ userId: 'A' }), page({ userId: 'A', after: '9' })]);
    setItems([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    const report = await refreshFamilies(env, [family]);
    expect(report.failed).toBe(false);
    expect(family.pages.map((entry) => entry.variables.after)).toEqual([undefined, '11', '9']);
  });

  it('does nothing for no families and for a family with no pages', async () => {
    const { env, queries } = setup();
    expect(await refreshFamilies(env, [])).toEqual({ requests: 0, failed: false });
    expect(await refreshFamilies(env, [{ id: 'x', filters: {}, pages: [], route: ROUTE }])).toEqual({ requests: 0, failed: false });
    expect(queries).toHaveLength(0);
  });
});
