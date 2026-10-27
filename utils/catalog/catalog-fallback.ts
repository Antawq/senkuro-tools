import { concat, fromValue, make, map, pipe, switchMap } from 'wonka';
import type { Source } from 'wonka';

import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { isSettled, type SourceResult } from '../shared/urql-source';
import { searchRequestOf } from './catalog-filters';
import { streamCatalogMatches } from './catalog-matches';
import { catalogKindOf, isEmptyCatalogAnswer, toCatalogData } from './catalog-results';
import { sortOrderOf } from './catalog-sort';

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

interface CatalogAnswer extends SourceResult {
  data?: unknown;
  error?: unknown;
}

export function installCatalogFallback(client: QueryClient, isHydrating: () => boolean): void {
  const original = client.executeQuery.bind(client);

  Reflect.set(client, 'executeQuery', (request: QueryRequest, options?: Record<string, unknown>) => {
    const source = original(request, options);
    const kind = catalogKindOf(operationName(request));
    const search = kind ? searchRequestOf(request.variables, kind) : null;
    if (!kind || !search || typeof source !== 'function') return source;
    const isHydration = isHydrating();
    const order = sortOrderOf(request.variables, kind);

    return pipe(
      source as Source<CatalogAnswer>,
      switchMap((answer) => {
        if (!isSettled(answer) || !isEmptyCatalogAnswer(answer, kind)) return fromValue(answer);
        const rows = pipe(
          sourceOfStream((signal) => streamCatalogMatches(client, kind, { text: search.text.toLowerCase(), order, filters: search.filters }, options, signal)),
          map((matches) => {
            const data = toCatalogData(matches, kind);
            return data ? { ...answer, data, error: undefined, stale: false, hasNext: false } : answer;
          })
        );
        return isHydration ? concat([fromValue(answer), rows]) : rows;
      })
    );
  });
}
