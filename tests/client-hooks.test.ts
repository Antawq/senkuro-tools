import { describe, expect, it } from 'vitest';

import { rewriteLists, type PriceRewriter } from '../utils/inventory/client-hooks';
import { LIST_OPERATION } from '../utils/inventory/list-families';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';

const request = (name: string, variables: Record<string, unknown> = {}): QueryRequest => ({
  key: 1,
  variables,
  query: {
    definitions: [
      { kind: 'FragmentDefinition', name: { value: 'Part' } },
      { kind: 'OperationDefinition', name: { value: name } },
    ],
  },
});

const clientWith = () => {
  const calls: { queries: { request: QueryRequest; options: Record<string, unknown> | undefined }[] } = { queries: [] };
  const client: QueryClient = {
    executeQuery(asked, options) {
      calls.queries.push({ request: asked, options });
      return 'source';
    },
    executeMutation: () => null,
    query: () => ({ toPromise: () => Promise.resolve({}) }),
  };
  return { client, calls };
};

describe('rewriteLists', () => {
  const viewWatching = () => {
    const watched: { request: QueryRequest; options: Record<string, unknown> | undefined }[] = [];
    const view: PriceRewriter = {
      watch: (asked, options) => void watched.push({ request: asked, options }),
      rewrite: (asked) => ({ ...asked, variables: { ...asked.variables, orderField: 'PRIVATE' } }),
    };
    return { view, watched };
  };

  it('lets the view watch a list query and sends on the request it rewrote', () => {
    const { client, calls } = clientWith();
    const { view, watched } = viewWatching();
    expect(rewriteLists(client, view, new WeakSet())).toBe(true);
    const asked = request(LIST_OPERATION, { userId: 'USER:1' });
    client.executeQuery(asked, { suspense: true });
    expect(watched).toEqual([{ request: asked, options: { suspense: true } }]);
    expect(calls.queries[0]?.request.variables).toEqual({ userId: 'USER:1', orderField: 'PRIVATE' });
  });

  it('keeps the view from watching the silent replays of the guard, which are no request of the page, and still rewrites them', () => {
    const { client, calls } = clientWith();
    const { view, watched } = viewWatching();
    const silent = new WeakSet<object>();
    const silentFetch = () => Promise.resolve(new Response());
    silent.add(silentFetch);
    rewriteLists(client, view, silent);
    client.executeQuery(request(LIST_OPERATION, { userId: 'USER:1' }), { fetch: silentFetch });
    expect(watched).toEqual([]);
    expect(calls.queries[0]?.request.variables).toEqual({ userId: 'USER:1', orderField: 'PRIVATE' });
  });

  it('leaves the other operations to the client', () => {
    const { client, calls } = clientWith();
    const { view, watched } = viewWatching();
    rewriteLists(client, view, new WeakSet());
    const asked = request('fetchViewer', { userId: 'USER:1' });
    client.executeQuery(asked);
    expect(watched).toEqual([]);
    expect(calls.queries[0]?.request).toBe(asked);
  });
});
