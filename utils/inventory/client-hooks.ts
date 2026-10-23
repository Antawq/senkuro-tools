import type { Sink } from 'wonka';

import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { tapSource } from '../shared/urql-source';
import { LIST_OPERATION, type PageRequest } from './list-families';

const POLICY_OPTION = 'requestPolicy';

export interface MutationResult {
  operation?: QueryRequest;
  data?: Record<string, unknown> | null;
  error?: unknown;
  stale?: boolean;
  hasNext?: boolean;
}

const recording = new WeakSet<QueryClient>();
const tapping = new WeakSet<QueryClient>();

const withoutPolicy = (options: Record<string, unknown> | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(options ?? {}).filter(([name]) => name !== POLICY_OPTION));

const isSilent = (options: Record<string, unknown> | undefined, silent: WeakSet<object>): boolean =>
  typeof options?.fetch === 'function' && silent.has(options.fetch);

export function recordLists(client: QueryClient, onPage: (page: PageRequest) => void, silent: WeakSet<object>): boolean {
  if (recording.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      if (operationName(request) === LIST_OPERATION && request.variables && !isSilent(options, silent)) {
        onPage({ document: request.query, variables: request.variables, options: withoutPolicy(options) });
      }
      return original(request, options);
    };
  } catch {
    return false;
  }
  recording.add(client);
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
