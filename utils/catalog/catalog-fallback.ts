import { concat, fromValue, make, map, pipe, switchMap } from 'wonka';
import type { Source } from 'wonka';

import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { isSettled, type SourceResult } from '../shared/urql-source';
import { streamCatalogMatches } from './catalog-matches';
import { asksOnlyForSearch, catalogKindOf, isEmptyCatalogAnswer, toCatalogData } from './catalog-results';
import { sortOrderOf } from './catalog-sort';

const sourceOfStream = <T>(stream: AsyncIterable<T>): Source<T> =>
  make<T>((observer) => {
    let isClosed = false;
    void (async () => {
      for await (const value of stream) {
        if (isClosed) return;
        observer.next(value);
      }
      if (!isClosed) observer.complete();
    })();
    return () => {
      isClosed = true;
    };
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
    const text = kind ? asksOnlyForSearch(request.variables) : null;
    if (!kind || !text || typeof source !== 'function') return source;
    const isHydration = isHydrating();
    const order = sortOrderOf(request.variables, kind);

    return pipe(
      source as Source<CatalogAnswer>,
      switchMap((answer) => {
        if (!isSettled(answer) || !isEmptyCatalogAnswer(answer, kind)) return fromValue(answer);
        const rows = pipe(
          sourceOfStream(streamCatalogMatches(client, kind, text.toLowerCase(), order, options)),
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
