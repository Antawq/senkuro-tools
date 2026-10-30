import { getOperationName, makeOperation, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { map, pipe, tap } from 'wonka';

import type { PageWindow } from '../shared/page-window';
import { isSettled } from '../shared/urql-result';
import { SEARCH_EVENT, type SearchSignal } from './search-event';
import { SEARCH_OPERATION, widenSearchQuery } from './search-page-size';

export const SEARCH_PAGE_SIZE = 30;

type PublishSearch = (signal: SearchSignal) => void;

interface SearchTerms {
  query: string;
  type: string;
}

interface OpenSearch {
  terms: SearchTerms;
  startCount: number;
}

const termsOf = (operation: Operation): SearchTerms | null => {
  if (operation.kind !== 'query' || getOperationName(operation.query) !== SEARCH_OPERATION) return null;
  const { query, type } = (operation.variables ?? {}) as Record<string, unknown>;
  return typeof query === 'string' && typeof type === 'string' ? { query, type } : null;
};

const firstSlugOf = (result: OperationResult): string | null => {
  const data = result.data as { search?: { edges?: { node?: { slug?: unknown } }[] } | null } | null | undefined;
  const slug = data?.search?.edges?.[0]?.node?.slug;
  return typeof slug === 'string' ? slug : null;
};

function widened(operation: Operation, pageSize: number): Operation {
  const query = termsOf(operation) ? widenSearchQuery(operation.query, pageSize) : null;
  return query ? makeOperation(operation.kind, { ...operation, query }, operation.context) : operation;
}

export const createSearchPublisher =
  (pageWindow: PageWindow): PublishSearch =>
  (signal) =>
    pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(SEARCH_EVENT, { detail: JSON.stringify(signal) }));

interface SearchWatch {
  publish: PublishSearch;
  searchesByKey: Map<number, OpenSearch>;
}

const publishUnsettled = (publish: PublishSearch, { terms, startCount }: OpenSearch): void => {
  for (let count = startCount; count > 0; count--) publish({ phase: 'done', ...terms });
};

function watchOperation(watch: SearchWatch, operation: Operation): void {
  const open = watch.searchesByKey.get(operation.key);
  if (operation.kind === 'teardown') {
    watch.searchesByKey.delete(operation.key);
    if (open) publishUnsettled(watch.publish, open);
    return;
  }
  const terms = termsOf(operation);
  if (!terms) return;
  watch.searchesByKey.set(operation.key, { terms, startCount: (open?.startCount ?? 0) + 1 });
  watch.publish({ phase: 'start', ...terms });
}

function watchResult(watch: SearchWatch, result: OperationResult): void {
  const open = watch.searchesByKey.get(result.operation.key);
  if (!open || open.startCount === 0 || !isSettled(result)) return;
  open.startCount -= 1;
  watch.publish({ phase: 'done', ...open.terms, settled: true, firstSlug: firstSlugOf(result) });
}

export function searchExchange(publish: PublishSearch, pageSize = SEARCH_PAGE_SIZE): Exchange {
  return ({ forward }) =>
    (operations$) => {
      const watch: SearchWatch = { publish, searchesByKey: new Map() };
      return pipe(
        forward(
          pipe(
            operations$,
            tap((operation: Operation) => watchOperation(watch, operation)),
            map((operation: Operation) => widened(operation, pageSize))
          )
        ),
        tap((result: OperationResult) => watchResult(watch, result))
      );
    };
}
