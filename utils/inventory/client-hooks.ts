import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { LIST_OPERATION } from './list-families';
import type { PriceView } from './price-view';

export type PriceRewriter = Pick<PriceView, 'watch' | 'rewrite'>;

export interface MutationResult {
  operation?: QueryRequest;
  data?: Record<string, unknown> | null;
  error?: unknown;
  stale?: boolean;
  hasNext?: boolean;
}

const rewriting = new WeakSet<QueryClient>();

const isSilent = (options: Record<string, unknown> | undefined, silent: WeakSet<object>): boolean =>
  typeof options?.fetch === 'function' && silent.has(options.fetch);

export function rewriteLists(client: QueryClient, view: PriceRewriter, silent: WeakSet<object>): boolean {
  if (rewriting.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      if (operationName(request) !== LIST_OPERATION) return original(request, options);
      if (!isSilent(options, silent)) view.watch(request, options);
      return original(view.rewrite(request), options);
    };
  } catch {
    return false;
  }
  rewriting.add(client);
  return true;
}
