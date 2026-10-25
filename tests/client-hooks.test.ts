import { describe, expect, it } from 'vitest';

import { filter, make, onPush, pipe, subscribe, take, toPromise } from 'wonka';
import type { Source } from 'wonka';

import { recordLists, rewriteLists, tapMutations, type MutationResult, type PriceRewriter } from '../utils/inventory/client-hooks';
import { LIST_OPERATION, type PageRequest } from '../utils/inventory/list-families';
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

const settled = (data: Record<string, unknown>): MutationResult => ({ data, stale: false, hasNext: false });

interface Calls {
  queries: { request: QueryRequest; options: Record<string, unknown> | undefined }[];
  dispatched: number;
}

const clientWith = (results: MutationResult[] = [settled({ done: true })]) => {
  const calls: Calls = { queries: [], dispatched: 0 };
  const client: QueryClient = {
    executeQuery(asked, options) {
      calls.queries.push({ request: asked, options });
      return 'source';
    },
    executeMutation: () =>
      make<MutationResult>((observer) => {
        calls.dispatched += 1;
        results.forEach((result) => observer.next(result));
        observer.complete();
        return () => undefined;
      }),
    query: () => ({ toPromise: () => Promise.resolve({}) }),
  };
  return { client, calls };
};

describe('recordLists', () => {
  const record = (client: QueryClient, silent = new WeakSet<object>()) => {
    const pages: PageRequest[] = [];
    const patched = recordLists(client, (page) => pages.push(page), silent);
    return { pages, patched, silent };
  };

  it('records every list query with its document, variables and options minus the policy, and still runs it', () => {
    const { client, calls } = clientWith();
    const { pages, patched } = record(client);
    expect(patched).toBe(true);
    const asked = request(LIST_OPERATION, { userId: 'USER:1', after: 'c1' });
    expect(client.executeQuery(asked, { requestPolicy: 'cache-first', suspense: true })).toBe('source');
    expect(pages).toEqual([{ document: asked.query, variables: { userId: 'USER:1', after: 'c1' }, options: { suspense: true } }]);
    expect(calls.queries[0]?.options).toEqual({ requestPolicy: 'cache-first', suspense: true });
  });

  it('ignores other operations, queries without variables and its own silent replays', () => {
    const { client, calls } = clientWith();
    const silentFetch = () => Promise.resolve(new Response());
    const { pages, silent } = record(client);
    silent.add(silentFetch);
    client.executeQuery(request('fetchViewer'));
    client.executeQuery({ key: 2, query: request(LIST_OPERATION).query });
    client.executeQuery(request(LIST_OPERATION, { userId: 'USER:1' }), { fetch: silentFetch });
    expect(pages).toEqual([]);
    expect(calls.queries).toHaveLength(3);
  });

  it('wraps a client once and gives up quietly on one that cannot be changed', () => {
    const twice = clientWith();
    const first = record(twice.client);
    recordLists(twice.client, () => undefined, new WeakSet());
    twice.client.executeQuery(request(LIST_OPERATION, { userId: 'USER:1' }));
    expect(first.pages).toHaveLength(1);
    expect(twice.calls.queries).toHaveLength(1);
    const frozen = clientWith().client;
    Object.freeze(frozen);
    expect(record(frozen).patched).toBe(false);
  });
});

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

describe('tapMutations', () => {
  const tap = (client: QueryClient) => {
    const seen: MutationResult[] = [];
    const patched = tapMutations(client, (result) => seen.push(result));
    return { seen, patched };
  };

  const ask = (client: QueryClient) => client.executeMutation(request('forgeCards'));

  type Tapped = Source<MutationResult> & {
    toPromise(): Promise<MutationResult>;
    then: PromiseLike<MutationResult>['then'];
    subscribe(callback: (result: MutationResult) => void): { unsubscribe(): void };
  };

  it('reports a settled result once, after it is applied, however the site reads it: piped like urql-vue', async () => {
    const { client, calls } = clientWith();
    const { seen } = tap(client);
    const source = ask(client) as Tapped;
    const result = await pipe(
      source,
      onPush(() => undefined),
      filter((entry) => !entry.hasNext),
      take(1),
      toPromise
    );
    expect(result).toEqual(settled({ done: true }));
    expect(seen).toEqual([settled({ done: true })]);
    expect(calls.dispatched).toBe(1);
  });

  it('works when the result is awaited, converted with toPromise, or subscribed to', async () => {
    for (const read of [
      (source: Tapped) => source.then((result) => result),
      (source: Tapped) => source.toPromise(),
      (source: Tapped) => new Promise<MutationResult>((resolve) => source.subscribe(resolve)),
    ]) {
      const { client, calls } = clientWith();
      const { seen } = tap(client);
      const result = await read(ask(client) as Tapped);
      expect(result).toEqual(settled({ done: true }));
      expect(seen).toHaveLength(1);
      expect(calls.dispatched).toBe(1);
    }
  });

  it('subscribes through wonka the way the site does and still dispatches once', async () => {
    const { client, calls } = clientWith();
    const { seen } = tap(client);
    const results: MutationResult[] = [];
    pipe(
      ask(client) as Tapped,
      subscribe((result) => results.push(result))
    );
    await Promise.resolve();
    expect(results).toEqual([settled({ done: true })]);
    expect(seen).toHaveLength(1);
    expect(calls.dispatched).toBe(1);
  });

  it('does not report a stale or streaming result, only the settled one', async () => {
    const { client } = clientWith([{ data: { done: false }, stale: true }, { data: { done: false }, hasNext: true }, settled({ done: true })]);
    const { seen } = tap(client);
    await (ask(client) as Tapped).toPromise();
    expect(seen).toEqual([settled({ done: true })]);
  });

  it('keeps the site working when the callback throws', async () => {
    const { client } = clientWith();
    tapMutations(client, () => {
      throw new Error('boom');
    });
    expect(await (ask(client) as Tapped).toPromise()).toEqual(settled({ done: true }));
  });

  it('returns whatever is not a stream untouched', () => {
    const client = clientWith().client;
    const plain = { not: 'a source' };
    client.executeMutation = () => plain;
    expect(tap(client).patched).toBe(true);
    expect(ask(client)).toBe(plain);
  });

  it('wraps a client once, so a result is never reported twice', async () => {
    const { client, calls } = clientWith();
    const first = tap(client);
    const second = tap(client);
    await (ask(client) as Tapped).toPromise();
    expect(first.seen).toHaveLength(1);
    expect(second.seen).toHaveLength(0);
    expect(second.patched).toBe(true);
    expect(calls.dispatched).toBe(1);
  });

  it('gives up quietly on a client whose method cannot be replaced', () => {
    const frozen = clientWith().client;
    Object.freeze(frozen);
    expect(tap(frozen).patched).toBe(false);
  });
});

describe('recordLists and the first page of a list shown from the cache', () => {
  const listResult = (cacheOutcome: string, overrides: Record<string, unknown> = {}) => ({
    data: {},
    stale: false,
    hasNext: false,
    operation: { context: { meta: { cacheOutcome } } },
    ...overrides,
  });

  const clientAnswering = (results: Record<string, unknown>[]) => {
    const client: QueryClient = {
      executeQuery: () =>
        make<Record<string, unknown>>((observer) => {
          results.forEach((result) => observer.next(result));
          observer.complete();
          return () => undefined;
        }),
      executeMutation: () => null,
      query: () => ({ toPromise: () => Promise.resolve({}) }),
    };
    return client;
  };

  const watch = (results: Record<string, unknown>[], variables: Record<string, unknown>, options?: Record<string, unknown>, operation = LIST_OPERATION) => {
    const client = clientAnswering(results);
    const hits: PageRequest[] = [];
    const pages: PageRequest[] = [];
    recordLists(
      client,
      (page) => pages.push(page),
      new WeakSet(),
      (page) => hits.push(page)
    );
    const seen: unknown[] = [];
    pipe(
      client.executeQuery(request(operation, variables), options) as Source<unknown>,
      subscribe((result) => seen.push(result))
    );
    return { hits, pages, seen };
  };

  it('reports the first page the cache answered completely, once however many results follow, and still gives the site every result', () => {
    const { hits, seen } = watch([listResult('hit'), listResult('hit'), listResult('hit')], { userId: 'USER:1' });
    expect(hits.map((page) => page.variables)).toEqual([{ userId: 'USER:1' }]);
    expect(seen).toHaveLength(3);
  });

  it('ignores a first page the network answered or the cache answered only in part', () => {
    expect(watch([listResult('miss')], { userId: 'USER:1' }).hits).toEqual([]);
    expect(watch([listResult('partial')], { userId: 'USER:1' }).hits).toEqual([]);
    expect(watch([{ data: {}, stale: false, hasNext: false }], { userId: 'USER:1' }).hits).toEqual([]);
  });

  it('judges only the first result of a request, so a later result never starts anything', () => {
    expect(watch([listResult('miss'), listResult('hit')], { userId: 'USER:1' }).hits).toEqual([]);
    expect(watch([listResult('hit', { stale: true }), listResult('miss')], { userId: 'USER:1' }).hits).toEqual([]);
  });

  it('ignores a later page, a request of another operation and a request with no variables to name a list', () => {
    expect(watch([listResult('hit')], { userId: 'USER:1', after: 'c1' }).hits).toEqual([]);
    expect(watch([listResult('hit')], { userId: 'USER:1' }, undefined, 'fetchViewer').hits).toEqual([]);
  });

  it('records a page without its request policy, so a replay sets its own', () => {
    const { pages } = watch([listResult('hit')], { userId: 'USER:1' }, { requestPolicy: 'network-only', suspense: true });
    expect(pages.map((page) => page.options)).toEqual([{ suspense: true }]);
  });

  it('hands back the stream untouched when nobody asked for cache hits, and whatever is not a stream as it is', () => {
    const client = clientAnswering([listResult('hit')]);
    const plain = client.executeQuery(request(LIST_OPERATION, { userId: 'USER:1' }));
    recordLists(client, () => undefined, new WeakSet());
    expect(typeof client.executeQuery(request(LIST_OPERATION, { userId: 'USER:1' }))).toBe('function');
    expect(typeof plain).toBe('function');
    const notStream = { not: 'a source' };
    const other = clientAnswering([]);
    other.executeQuery = () => notStream;
    const hits: PageRequest[] = [];
    recordLists(
      other,
      () => undefined,
      new WeakSet(),
      (page) => hits.push(page)
    );
    expect(other.executeQuery(request(LIST_OPERATION, { userId: 'USER:1' }))).toBe(notStream);
    expect(hits).toEqual([]);
  });
});
