import { getOperationName, type Client, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { concat, filter, fromValue, make, makeSubject, map, merge, mergeMap, onEnd, pipe, share, switchMap, takeUntil, tap } from 'wonka';
import type { Source } from 'wonka';

import { isSettled } from '../shared/urql-source';
import { searchRequestOf } from './catalog-filters';
import { streamCatalogMatches, type MatchQuery } from './catalog-matches';
import { catalogKindOf, isEmptyCatalogAnswer, toCatalogData, type CatalogKind } from './catalog-results';
import { sortOrderOf } from './catalog-sort';

interface CatalogSearch {
  kind: CatalogKind;
  query: MatchQuery;
  isHydration: boolean;
}

const sourceOfStream = <T>(openStream: (signal: AbortSignal) => AsyncIterable<T>): Source<T> =>
  make<T>((observer) => {
    const controller = new AbortController();
    void (async () => {
      for await (const value of openStream(controller.signal)) {
        if (controller.signal.aborted) return;
        observer.next(value);
      }
      if (!controller.signal.aborted) observer.complete();
    })();
    return () => controller.abort();
  });

function catalogSearchOf(operation: Operation, isHydrating: () => boolean): CatalogSearch | null {
  if (operation.kind !== 'query') return null;
  const kind = catalogKindOf(getOperationName(operation.query));
  const variables = operation.variables ?? undefined;
  const search = kind ? searchRequestOf(variables, kind) : null;
  if (!kind || !search) return null;
  const query = { text: search.text.toLowerCase(), order: sortOrderOf(variables, kind), filters: search.filters };
  return { kind, query, isHydration: isHydrating() };
}

function answersOf(client: Client, answer: OperationResult, search: CatalogSearch | undefined): Source<OperationResult> {
  if (!search || !isSettled(answer) || !isEmptyCatalogAnswer(answer, search.kind)) return fromValue(answer);
  const rows = pipe(
    sourceOfStream((signal) => streamCatalogMatches(client, search.kind, search.query, undefined, signal)),
    map((matches): OperationResult => {
      const data = toCatalogData(matches, search.kind);
      return data ? { ...answer, data, error: undefined, stale: false, hasNext: false } : answer;
    })
  );
  return search.isHydration ? concat([fromValue(answer), rows]) : rows;
}

export function catalogFallbackExchange(isHydrating: () => boolean): Exchange {
  return ({ client, forward }) =>
    (operations$) => {
      const searchesByKey = new Map<number, CatalogSearch>();
      const openedKeys = makeSubject<number>();
      const sharedOperations$ = share(operations$);
      const teardowns$ = pipe(
        sharedOperations$,
        filter((operation) => operation.kind === 'teardown')
      );

      const handleOperation = (operation: Operation): void => {
        const search = catalogSearchOf(operation, isHydrating);
        if (!search) return;
        const isOpen = searchesByKey.has(operation.key);
        searchesByKey.set(operation.key, search);
        if (!isOpen) openedKeys.next(operation.key);
      };

      const results$ = share(forward(pipe(sharedOperations$, tap(handleOperation))));

      const answersFor = (key: number): Source<OperationResult> =>
        pipe(
          results$,
          filter((result) => result.operation.key === key),
          switchMap((result) => answersOf(client, result, searchesByKey.get(key))),
          takeUntil(
            pipe(
              teardowns$,
              filter((operation) => operation.key === key)
            )
          ),
          onEnd(() => searchesByKey.delete(key))
        );

      return merge([
        pipe(
          results$,
          filter((result) => !searchesByKey.has(result.operation.key))
        ),
        pipe(openedKeys.source, mergeMap(answersFor)),
      ]);
    };
}
