import { describe, expect, it, vi } from 'vitest';

import { Client, gql, makeOperation, type Operation, type OperationResult } from '@urql/core';
import { makeSubject, map, pipe, subscribe } from 'wonka';

import { CATALOG_LIST_OPERATIONS, listRequestExchange } from '../utils/catalog/list-requests';

const client = new Client({ url: 'https://api.senkuro.me/graphql', exchanges: [] });
const documentNamed = (name: string) => gql(`query ${name}($after: String) { mangas(after: $after) { totalCount } }`);
const queryOf = (name: string, key: number): Operation => client.createRequestOperation('query', { key, query: documentNamed(name), variables: {} });

const rig = () => {
  const noted = vi.fn();
  const operations = makeSubject<Operation>();
  const exchange = listRequestExchange(noted)({
    client,
    dispatchDebug: () => undefined,
    forward: (operations$) =>
      pipe(
        operations$,
        map((operation): OperationResult => ({ operation, data: null, stale: false, hasNext: false }) as OperationResult)
      ),
  });
  pipe(
    exchange(operations.source),
    subscribe(() => undefined)
  );
  return { noted, send: (operation: Operation) => operations.next(operation) };
};

describe('listRequestExchange', () => {
  it('notes a catalog list request whose key differs from the last one of its name, for every catalog', () => {
    for (const name of CATALOG_LIST_OPERATIONS) {
      const { noted, send } = rig();
      send(queryOf(name, 1));
      expect(noted).not.toHaveBeenCalled();
      send(queryOf(name, 2));
      expect(noted).toHaveBeenCalledOnce();
    }
  });

  it('notes nothing when the same key is sent again, as a re-dispatch of an unchanged list', () => {
    const { noted, send } = rig();
    send(queryOf('fetchMangas', 1));
    send(queryOf('fetchMangas', 1));
    send(makeOperation('teardown', queryOf('fetchMangas', 1)));
    send(queryOf('fetchMangas', 1));
    expect(noted).not.toHaveBeenCalled();
  });

  it('notes nothing for other queries, the catalog fallback asks included', () => {
    const { noted, send } = rig();
    for (const name of ['catalogSearch', 'catalogRowFacts', 'fetchUserCards', 'search']) {
      send(queryOf(name, 1));
      send(queryOf(name, 2));
    }
    expect(noted).not.toHaveBeenCalled();
  });

  it('keeps the last key per name, so lists of two catalogs do not mix', () => {
    const { noted, send } = rig();
    send(queryOf('fetchMangas', 1));
    send(queryOf('fetchCards', 5));
    send(queryOf('fetchMangas', 1));
    expect(noted).not.toHaveBeenCalled();
    send(queryOf('fetchCards', 6));
    expect(noted).toHaveBeenCalledOnce();
  });
});
