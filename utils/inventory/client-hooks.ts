import type { Sink } from 'wonka';

import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { tapSource, type SourceResult } from '../shared/urql-source';
import { hasCursor, LIST_OPERATION, type PageRequest } from './list-families';

const POLICY_OPTION = 'requestPolicy';
const CACHE_HIT = 'hit';

export interface PriceRewriter {
  watch: (request: QueryRequest, options: Record<string, unknown> | undefined) => void;
  rewrite: (request: QueryRequest) => QueryRequest;
}

export interface MutationResult {
  operation?: QueryRequest;
  data?: Record<string, unknown> | null;
  error?: unknown;
  stale?: boolean;
  hasNext?: boolean;
}

interface ListOperationResult extends SourceResult {
  operation?: { context?: { meta?: { cacheOutcome?: unknown } } };
}

const recording = new WeakSet<QueryClient>();
const rewriting = new WeakSet<QueryClient>();
const tapping = new WeakSet<QueryClient>();

const withoutPolicy = (options: Record<string, unknown> | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(options ?? {}).filter(([name]) => name !== POLICY_OPTION));

const isSilent = (options: Record<string, unknown> | undefined, silent: WeakSet<object>): boolean =>
  typeof options?.fetch === 'function' && silent.has(options.fetch);

function tapFirstCacheHit(source: unknown, onCacheHit: () => void): unknown {
  if (typeof source !== 'function') return source;
  let isFirstResult = true;
  return tapSource(source as (sink: Sink<ListOperationResult>) => void, {
    onSettled: (listResult) => {
      if (!isFirstResult) return;
      isFirstResult = false;
      if (listResult.operation?.context?.meta?.cacheOutcome === CACHE_HIT) onCacheHit();
    },
  });
}

export function recordLists(
  client: QueryClient,
  onPage: (page: PageRequest) => void,
  silent: WeakSet<object>,
  onCacheHit?: (page: PageRequest) => void
): boolean {
  if (recording.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      if (operationName(request) !== LIST_OPERATION || !request.variables || isSilent(options, silent)) return original(request, options);
      const page = { document: request.query, variables: request.variables, options: withoutPolicy(options) };
      onPage(page);
      const source = original(request, options);
      return onCacheHit && !hasCursor(page.variables) ? tapFirstCacheHit(source, () => onCacheHit(page)) : source;
    };
  } catch {
    return false;
  }
  recording.add(client);
  return true;
}

export function rewriteLists(client: QueryClient, view: PriceRewriter): boolean {
  if (rewriting.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      if (operationName(request) !== LIST_OPERATION) return original(request, options);
      view.watch(request, options);
      return original(view.rewrite(request), options);
    };
  } catch {
    return false;
  }
  rewriting.add(client);
  return true;
}

export function tapMutations(client: QueryClient, onResult: (result: MutationResult) => void): boolean {
  if (tapping.has(client)) return true;
  const original = client.executeMutation.bind(client);
  try {
    client.executeMutation = (request, options) => {
      const source = original(request, options);
      return typeof source === 'function' ? tapSource(source as (sink: Sink<MutationResult>) => void, { onSettled: onResult }) : source;
    };
  } catch {
    return false;
  }
  tapping.add(client);
  return true;
}
