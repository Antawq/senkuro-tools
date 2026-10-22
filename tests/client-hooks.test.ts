import { describe, expect, it } from 'vitest';

import { filter, make, onPush, pipe, subscribe, take, toPromise } from 'wonka';
import type { Source } from 'wonka';

import { recordLists, tapMutations, type MutationResult } from '../utils/inventory/client-hooks';
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
