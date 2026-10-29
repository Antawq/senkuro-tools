import { getOperationName, type Client, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { concat, filter, fromValue, make, makeSubject, map, merge, mergeMap, onEnd, pipe, share, switchMap, takeUntil, tap } from 'wonka';
import type { Source, Subject } from 'wonka';

import { isSettled } from '../shared/urql-result';
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

interface CatalogWatch {
  client: Client;
  isHydrating: () => boolean;
  searchesByKey: Map<number, CatalogSearch>;
  openedKeys: Subject<number>;
}

function watchOperation(watch: CatalogWatch, operation: Operation): void {
  const search = catalogSearchOf(operation, watch.isHydrating);
  if (!search) return;
  const isOpen = watch.searchesByKey.has(operation.key);
  watch.searchesByKey.set(operation.key, search);
  if (!isOpen) watch.openedKeys.next(operation.key);
}

interface CatalogStreams {
  results$: Source<OperationResult>;
  teardowns$: Source<Operation>;
}

const answersForKey = (watch: CatalogWatch, { results$, teardowns$ }: CatalogStreams, key: number): Source<OperationResult> =>
  pipe(
    results$,
    filter((result) => result.operation.key === key),
    switchMap((result) => answersOf(watch.client, result, watch.searchesByKey.get(key))),
    takeUntil(
      pipe(
        teardowns$,
        filter((operation) => operation.key === key)
      )
    ),
    onEnd(() => watch.searchesByKey.delete(key))
  );

export function catalogFallbackExchange(isHydrating: () => boolean): Exchange {
  return ({ client, forward }) =>
    (operations$) => {
      const watch: CatalogWatch = { client, isHydrating, searchesByKey: new Map(), openedKeys: makeSubject() };
      const sharedOperations$ = share(operations$);
      const teardowns$ = pipe(
        sharedOperations$,
        filter((operation) => operation.kind === 'teardown')
      );
      const results$ = share(
        forward(
          pipe(
            sharedOperations$,
            tap((operation: Operation) => watchOperation(watch, operation))
          )
        )
      );
      return merge([
        pipe(
          results$,
          filter((result) => !watch.searchesByKey.has(result.operation.key))
        ),
        pipe(
          watch.openedKeys.source,
          mergeMap((key: number) => answersForKey(watch, { results$, teardowns$ }, key))
        ),
      ]);
    };
}
