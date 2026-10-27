import type { Sink } from 'wonka';

import { claimPage } from '../shared/page-claim';
import type { PageWindow } from '../shared/page-window';
import { SEARCH_OPERATION, widenSearchRequest } from './search-page-size';
import { operationName, runWhenClientFound, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { tapSource, type SourceResult } from '../shared/urql-source';
import { SEARCH_EVENT, type SearchSignal } from '../shared/search-event';

export const SEARCH_PAGE_SIZE = 30;

type Publish = (signal: SearchSignal) => void;

interface SearchAnswer extends SourceResult {
  data?: { search?: { edges?: { node?: { slug?: unknown } }[] } | null };
}

const firstSlugOf = (answer: SearchAnswer): string | null => {
  const slug = answer.data?.search?.edges?.[0]?.node?.slug;
  return typeof slug === 'string' ? slug : null;
};

function publishSearchPhases(source: unknown, request: QueryRequest, publish: Publish): unknown {
  const { query, type } = request.variables ?? {};
  if (typeof source !== 'function' || typeof query !== 'string' || typeof type !== 'string') return source;
  let openCount = 0;
  const finish = (settledAnswer?: SearchAnswer) => {
    if (openCount === 0) return;
    openCount -= 1;
    publish(settledAnswer ? { phase: 'done', query, type, settled: true, firstSlug: firstSlugOf(settledAnswer) } : { phase: 'done', query, type });
  };
  return tapSource(source as (sink: Sink<SearchAnswer>) => void, {
    onStart: () => {
      openCount += 1;
      publish({ phase: 'start', query, type });
    },
    onSettled: finish,
    onEnd: () => finish(),
  });
}

export function installSearchWidening(client: QueryClient, publish: Publish = () => undefined, pageSize = SEARCH_PAGE_SIZE): void {
  const original = client.executeQuery.bind(client);
  Reflect.set(client, 'executeQuery', (request: QueryRequest, options?: Record<string, unknown>) => {
    const source = original(widenSearchRequest(request, pageSize), options);
    return operationName(request) === SEARCH_OPERATION ? publishSearchPhases(source, request, publish) : source;
  });
}

export function installSearchRequest(pageWindow: PageWindow): void {
  if (!claimPage(pageWindow, 'search-request')) return;
  const publish: Publish = (signal) => pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(SEARCH_EVENT, { detail: JSON.stringify(signal) }));
  runWhenClientFound(pageWindow, (client) => installSearchWidening(client, publish));
}
