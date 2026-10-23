import { fromValue, map, pipe, switchMap } from 'wonka';
import type { Source } from 'wonka';

import { SEARCH_OPERATION, widenSearchRequest } from '../shared/search-page-size';
import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { isSettled, type SourceResult } from '../shared/urql-source';
import { asksOnlyForSearch, catalogKindOf, isEmptyCatalogAnswer, toCatalogData } from './catalog-results';

export const CATALOG_SEARCH_PAGE_SIZE = 60;

interface CatalogAnswer extends SourceResult {
  data?: unknown;
  error?: unknown;
}

export function installCatalogFallback(client: QueryClient): void {
  const original = client.executeQuery.bind(client);
  const searchDocuments = new Map<string, QueryRequest['query']>();

  Reflect.set(client, 'executeQuery', (request: QueryRequest, options?: Record<string, unknown>) => {
    const name = operationName(request);
    const searchType = request.variables?.type;
    if (name === SEARCH_OPERATION && request.query && typeof searchType === 'string') searchDocuments.set(searchType, request.query);

    const source = original(request, options);
    const kind = catalogKindOf(name);
    const text = kind ? asksOnlyForSearch(request.variables) : null;
    if (!kind || !text || typeof source !== 'function') return source;

    return pipe(
      source as Source<CatalogAnswer>,
      switchMap((answer) => {
        const searchDocument = searchDocuments.get(kind.searchType);
        if (!searchDocument || !isSettled(answer) || !isEmptyCatalogAnswer(answer, kind)) return fromValue(answer);
        const widerSearch = widenSearchRequest({ query: searchDocument }, CATALOG_SEARCH_PAGE_SIZE);
        const found = client.query(widerSearch.query, { query: text.toLowerCase(), type: kind.searchType }, options) as unknown as Source<CatalogAnswer>;
        return pipe(
          found,
          map((searchAnswer) => {
            const data = toCatalogData(searchAnswer.data, kind);
            return data ? { ...answer, data, error: undefined, stale: searchAnswer.stale, hasNext: searchAnswer.hasNext } : answer;
          })
        );
      })
    );
  });
}
