import { describe, expect, it } from 'vitest';

import { MAX_PAGES, PAGE_SIZE, fetchAccountCards } from '../utils/account-cards';
import { ApiError, type Transport } from '../utils/graphql';

interface Sent {
  operationName: string;
  variables: Record<string, unknown>;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const node = (slug: string, quantity: number, shard = false) => ({ node: { quantity, shard, card: { slug } } });

const page = (edges: unknown[], next: string | null) => ({ data: { userCards: { pageInfo: { hasNextPage: next !== null, endCursor: next }, edges } } });

const viewer = { data: { viewer: { user: { id: 'user-1' } } } };

const bodyOf = (init?: RequestInit): string => (typeof init?.body === 'string' ? init.body : '{}');

const serve = (answer: (sent: Sent, index: number) => Response) => {
  const sent: Sent[] = [];
  const transport: Transport = {
    fetch: (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(bodyOf(init)) as Sent;
      sent.push(body);
      return Promise.resolve(answer(body, sent.length - 1));
    },
    sleep: () => Promise.resolve(),
    random: () => 0,
  };
  return { sent, transport };
};

describe('fetchAccountCards', () => {
  it('walks every page of the inventory by its cursor', async () => {
    const pages: Record<string, unknown> = {
      first: page([node('a-a', 2), node('b-b', 1)], 'c1'),
      c1: page([node('c-c', 5)], 'c2'),
      c2: page([node('d-d', 1, true)], null),
    };
    const { sent, transport } = serve((request) =>
      request.operationName === 'Viewer' ? json(viewer) : json(pages[(request.variables.after as string | null) ?? 'first'])
    );
    const progress: number[] = [];
    const cards = await fetchAccountCards('token', (loaded) => progress.push(loaded), transport);
    expect(cards).toEqual([
      { slug: 'a-a', quantity: 2, shard: false },
      { slug: 'b-b', quantity: 1, shard: false },
      { slug: 'c-c', quantity: 5, shard: false },
      { slug: 'd-d', quantity: 1, shard: true },
    ]);
    expect(progress).toEqual([2, 3, 4]);
    expect(sent.map((request) => request.operationName)).toEqual(['Viewer', 'UserCards', 'UserCards', 'UserCards']);
    expect(sent.slice(1).map((request) => request.variables)).toEqual([
      { userId: 'user-1', first: PAGE_SIZE, after: null, orderBy: { field: 'CREATED_AT', direction: 'ASC' } },
      { userId: 'user-1', first: PAGE_SIZE, after: 'c1', orderBy: { field: 'CREATED_AT', direction: 'ASC' } },
      { userId: 'user-1', first: PAGE_SIZE, after: 'c2', orderBy: { field: 'CREATED_AT', direction: 'ASC' } },
    ]);
  });

  it('asks only for the fields it uses', async () => {
    const queries: string[] = [];
    const transport: Transport = {
      fetch: (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(bodyOf(init)) as { query: string; operationName: string };
        queries.push(body.query);
        return Promise.resolve(json(body.operationName === 'Viewer' ? viewer : page([], null)));
      },
      sleep: () => Promise.resolve(),
      random: () => 0,
    };
    await fetchAccountCards('token', undefined, transport);
    expect(queries[0]).toContain('viewer { user { id } }');
    expect(queries[1]).toContain('edges { node { quantity shard card { slug } } }');
    expect(queries[1]).not.toMatch(/image|titles|locked|modifier/);
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
    const { transport } = serve((request) => json(request.operationName === 'Viewer' ? viewer : page(edges, null)));
    expect(await fetchAccountCards('token', undefined, transport)).toEqual([
      { slug: 'kept', quantity: 3, shard: false },
      { slug: 'piece', quantity: 2, shard: true },
      { slug: 'no-flag', quantity: 1, shard: false },
    ]);
  });

  it('answers an empty list for an empty or missing inventory', async () => {
    const empty = serve((request) => json(request.operationName === 'Viewer' ? viewer : page([], null)));
    expect(await fetchAccountCards('token', undefined, empty.transport)).toEqual([]);
    const missing = serve((request) => json(request.operationName === 'Viewer' ? viewer : { data: { userCards: null } }));
    expect(await fetchAccountCards('token', undefined, missing.transport)).toEqual([]);
  });

  it('stops when a page claims there is more but gives no cursor', async () => {
    const { sent, transport } = serve((request) =>
      json(request.operationName === 'Viewer' ? viewer : { data: { userCards: { pageInfo: { hasNextPage: true, endCursor: null }, edges: [node('a-a', 1)] } } })
    );
    expect(await fetchAccountCards('token', undefined, transport)).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  it('reports an unauthorized account when the viewer is missing and asks for no cards', async () => {
    for (const body of [{ data: { viewer: null } }, { data: { viewer: { user: null } } }]) {
      const { sent, transport } = serve(() => json(body));
      const error = await fetchAccountCards('token', undefined, transport).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ unauthorized: true });
      expect(sent).toHaveLength(1);
    }
  });

  it('gives up instead of walking pages for ever', async () => {
    let cursor = 0;
    const { sent, transport } = serve((request) => json(request.operationName === 'Viewer' ? viewer : page([node('a-a', 1)], `c${++cursor}`)));
    const error = await fetchAccountCards('token', undefined, transport).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ failure: 'limit' });
    expect(sent).toHaveLength(1 + MAX_PAGES);
  });

  it('passes an api failure on', async () => {
    const { transport } = serve(() => json({}, 503));
    expect(await fetchAccountCards('token', undefined, transport).catch((thrown: unknown) => thrown)).toMatchObject({ failure: 'http', status: 503 });
  });
});
