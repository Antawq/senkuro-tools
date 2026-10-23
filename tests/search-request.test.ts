import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';
import { make } from 'wonka';

import { SEARCH_PAGE_SIZE, installSearchRequest, installSearchWidening, widenSearchRequest } from '../utils/search/search-request';
import { SEARCH_EVENT, type SearchSignal } from '../utils/search/search-signal';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';

const argument = (name: string, argumentValue: string) => ({ kind: 'Argument', name: { value: name }, value: { kind: 'IntValue', value: argumentValue } });

const searchDocument = (first = '10', field = 'search') => ({
  __key: 123,
  definitions: [
    { kind: 'FragmentDefinition', name: { value: 'Part' } },
    {
      kind: 'OperationDefinition',
      name: { value: 'search' },
      selectionSet: {
        selections: [
          {
            kind: 'Field',
            name: { value: field },
            arguments: [{ kind: 'Argument', name: { value: 'query' }, value: { kind: 'Variable' } }, argument('first', first)],
            selectionSet: { selections: [{ kind: 'Field', name: { value: 'edges' }, arguments: [argument('first', '5')] }] },
          },
        ],
      },
    },
  ],
});

const request = (name: string, document = searchDocument(), key = 7): QueryRequest => ({
  key,
  variables: { query: 'naruto', type: 'MANGA' },
  query: { ...document, definitions: document.definitions.map((part) => (part.kind === 'OperationDefinition' ? { ...part, name: { value: name } } : part)) },
});

const firstOf = (asked: QueryRequest): string[] => {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const astNode = node as { kind?: string; name?: { value?: string }; value?: { value?: string } };
    if (astNode.kind === 'Argument' && astNode.name?.value === 'first') found.push(String(astNode.value?.value));
    Object.values(astNode).forEach(walk);
  };
  walk(asked.query);
  return found;
};

const keyOf = (asked: QueryRequest) => (asked.query as { __key?: number }).__key;

describe('widenSearchRequest', () => {
  it('raises the page size of the search field only, on a copy of the document that leaves the original and the key as they are', () => {
    const original = request('search');
    const wider = widenSearchRequest(original);
    expect(firstOf(wider)).toEqual([String(SEARCH_PAGE_SIZE), '5']);
    expect(firstOf(original)).toEqual(['10', '5']);
    expect(wider.query).not.toBe(original.query);
    expect(wider.key).toBe(original.key);
    expect(wider.variables).toBe(original.variables);
    expect(keyOf(wider)).toBeUndefined();
    expect(keyOf(original)).toBe(123);
  });

  it('gives the same answer for the same request', () => {
    const one = request('search');
    expect(widenSearchRequest(one)).toEqual(widenSearchRequest(one));
  });

  it('widens a document once and reuses the copy, so the client does not print and hash a new one per search', () => {
    const one = request('search');
    expect(widenSearchRequest(one).query).toBe(widenSearchRequest(one).query);
  });

  it('uses the size it is given', () => {
    expect(firstOf(widenSearchRequest(request('search'), 40))).toEqual(['40', '5']);
  });

  it('leaves every other operation exactly as it is', () => {
    const other = request('fetchUserCards');
    expect(widenSearchRequest(other)).toBe(other);
  });

  it('leaves a search that already asks for as much, or whose page size it cannot find', () => {
    const big = request('search', searchDocument('50'));
    expect(widenSearchRequest(big)).toBe(big);
    const renamed = request('search', searchDocument('10', 'lookup'));
    expect(widenSearchRequest(renamed)).toBe(renamed);
    const empty: QueryRequest = { key: 1 };
    expect(widenSearchRequest(empty)).toBe(empty);
  });
});

const clientWith = () => {
  const asked: QueryRequest[] = [];
  const client: QueryClient = {
    executeQuery(received) {
      asked.push(received);
      return 'source';
    },
    executeMutation: () => null,
    query: () => ({ toPromise: () => Promise.resolve({}) }),
  };
  return { client, asked };
};

describe('installSearchWidening', () => {
  it('sends the wider search to the site client and keeps the answer', () => {
    const { client, asked } = clientWith();
    installSearchWidening(client);
    expect(client.executeQuery(request('search'))).toBe('source');
    expect(firstOf(asked[0] as QueryRequest)).toEqual([String(SEARCH_PAGE_SIZE), '5']);
  });

  it('passes other requests through unchanged', () => {
    const { client, asked } = clientWith();
    installSearchWidening(client);
    const other = request('fetchUserCards');
    client.executeQuery(other);
    client.executeQuery(request('search'));
    expect(asked[0]).toBe(other);
    expect(asked).toHaveLength(2);
  });

  it('leaves a client whose method cannot be replaced as it is, without failing', () => {
    const { client } = clientWith();
    Object.freeze(client);
    expect(() => installSearchWidening(client)).not.toThrow();
  });
});

describe('installSearchRequest', () => {
  it('widens the searches once the site client exists, and installs once per page', async () => {
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const { client, asked } = clientWith();
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: { value: client } } } };
    pageWindow.fetch = (() => Promise.resolve(new Response('{}'))) as unknown as typeof pageWindow.fetch;
    const typed = pageWindow as unknown as Parameters<typeof installSearchRequest>[0];
    installSearchRequest(typed);
    installSearchRequest(typed);
    await pageWindow.fetch('https://api.senkuro.me/graphql');
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.executeQuery(request('search'));
    expect(asked).toHaveLength(1);
    expect(firstOf(asked[0] as QueryRequest)).toEqual([String(SEARCH_PAGE_SIZE), '5']);
  });
});

describe('search signals', () => {
  const streamingClient = (results: { stale?: boolean; data?: unknown }[] = [{}], complete = true): QueryClient => ({
    executeQuery: () =>
      make<{ stale?: boolean; data?: unknown }>((observer) => {
        results.forEach((entry) => observer.next(entry));
        if (complete) observer.complete();
        return () => undefined;
      }),
    executeMutation: () => null,
    query: () => ({ toPromise: () => Promise.resolve({}) }),
  });

  const streaming = (results?: { stale?: boolean; data?: unknown }[], complete?: boolean) => {
    const signals: SearchSignal[] = [];
    const client = streamingClient(results, complete);
    installSearchWidening(client, (signal) => signals.push(signal));
    return { client, signals };
  };

  it('publishes a search when it starts and when its answer is in, with what was asked', async () => {
    const { client, signals } = streaming([
      { stale: true },
      { data: { search: { edges: [{ node: { slug: 'naruto' } }, { node: { slug: 'naruto-gaiden' } }] } } },
    ]);
    const source = client.executeQuery(request('search'));
    expect(signals).toEqual([]);
    await (source as { toPromise(): Promise<unknown> }).toPromise();
    expect(signals).toEqual([
      { phase: 'start', query: 'naruto', type: 'MANGA' },
      { phase: 'done', query: 'naruto', type: 'MANGA', settled: true, firstSlug: 'naruto' },
    ]);
  });

  it('says there is no first result when the answer holds none, or holds something unexpected', async () => {
    for (const data of [
      { search: { edges: [] } },
      { search: null },
      { search: { edges: [{ node: {} }] } },
      { search: { edges: [{ node: { slug: 5 } }] } },
      undefined,
    ]) {
      const { client, signals } = streaming([{ data }]);
      await (client.executeQuery(request('search')) as { toPromise(): Promise<unknown> }).toPromise();
      expect(signals.at(-1)).toEqual({ phase: 'done', query: 'naruto', type: 'MANGA', settled: true, firstSlug: null });
    }
  });

  it('publishes the end of a search the page gave up on', () => {
    const { client, signals } = streaming([{ stale: true }], false);
    const subscription = (client.executeQuery(request('search')) as { subscribe(callback: () => void): { unsubscribe(): void } }).subscribe(() => undefined);
    expect(signals.map((signal) => signal.phase)).toEqual(['start']);
    subscription.unsubscribe();
    expect(signals.map((signal) => signal.phase)).toEqual(['start', 'done']);
    expect(signals.at(-1)).toEqual({ phase: 'done', query: 'naruto', type: 'MANGA' });
  });

  it('says nothing about other operations, or about a search whose variables are unknown', () => {
    const { client, signals } = streaming();
    const other = client.executeQuery(request('fetchUserCards'));
    expect(typeof other).toBe('function');
    expect((other as { toPromise?: unknown }).toPromise).toBeUndefined();
    const bare: QueryRequest = { ...request('search'), variables: undefined };
    const unknown = client.executeQuery(bare);
    expect((unknown as { toPromise?: unknown }).toPromise).toBeUndefined();
    expect(signals).toEqual([]);
  });

  it('hands back an answer that is not a stream untouched', () => {
    const plain = { not: 'a source' };
    const client: QueryClient = { executeQuery: () => plain, executeMutation: () => null, query: () => ({ toPromise: () => Promise.resolve({}) }) };
    const signals: SearchSignal[] = [];
    installSearchWidening(client, (signal) => signals.push(signal));
    expect(client.executeQuery(request('search'))).toBe(plain);
    expect(signals).toEqual([]);
  });

  it('reaches the extension as a document event with a JSON detail', async () => {
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const client = streamingClient();
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: { value: client } } } };
    pageWindow.fetch = (() => Promise.resolve(new Response('{}'))) as unknown as typeof pageWindow.fetch;
    installSearchRequest(pageWindow as unknown as Parameters<typeof installSearchRequest>[0]);
    const heard: unknown[] = [];
    pageWindow.document.addEventListener(SEARCH_EVENT, (event) => heard.push(JSON.parse((event as unknown as CustomEvent<string>).detail)));
    await pageWindow.fetch('https://api.senkuro.me/graphql');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await (client.executeQuery(request('search')) as { toPromise(): Promise<unknown> }).toPromise();
    expect(heard).toEqual([
      { phase: 'start', query: 'naruto', type: 'MANGA' },
      { phase: 'done', query: 'naruto', type: 'MANGA', settled: true, firstSlug: null },
    ]);
  });
});
