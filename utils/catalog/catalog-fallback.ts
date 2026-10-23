import { concat, fromValue, map, pipe, switchMap } from 'wonka';
import type { Source } from 'wonka';

import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { isSettled, type SourceResult } from '../shared/urql-source';
import { asksOnlyForSearch, catalogKindOf, isEmptyCatalogAnswer, toCatalogData } from './catalog-results';

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

    return pipe(
      source as Source<CatalogAnswer>,
      switchMap((answer) => {
        if (!isSettled(answer) || !isEmptyCatalogAnswer(answer, kind)) return fromValue(answer);
        const found = client.query(kind.searchDocument, { query: text.toLowerCase(), type: kind.searchType }, options) as unknown as Source<CatalogAnswer>;
        const rows = pipe(
          found,
          map((searchAnswer) => {
            const data = toCatalogData(searchAnswer.data, kind);
            return data ? { ...answer, data, error: undefined, stale: searchAnswer.stale, hasNext: searchAnswer.hasNext } : answer;
          })
        );
        return isHydration ? concat([fromValue(answer), rows]) : rows;
      })
    );
  });
}
