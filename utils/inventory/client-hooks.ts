import { filter, onPush, pipe, subscribe, take, toPromise } from 'wonka';
import type { Sink } from 'wonka';

import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { LIST_OPERATION, type PageRequest } from './list-families';

const POLICY_OPTION = 'requestPolicy';

export interface MutationResult {
  operation?: QueryRequest;
  data?: Record<string, unknown> | null;
  error?: unknown;
  stale?: boolean;
  hasNext?: boolean;
}

interface TappedSource {
  (sink: Sink<MutationResult>): void;
  toPromise(): Promise<MutationResult>;
  then: PromiseLike<MutationResult>['then'];
  subscribe(callback: (result: MutationResult) => void): { unsubscribe(): void };
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

const isSettled = (result: MutationResult): boolean => !result.stale && !result.hasNext;

function report(onResult: (result: MutationResult) => void, result: MutationResult): void {
  if (!isSettled(result)) return;
  try {
    onResult(result);
  } catch {
    return;
  }
}

function tap(source: (sink: Sink<MutationResult>) => void, onResult: (result: MutationResult) => void): TappedSource {
  const piped = pipe(
    source,
    onPush((result: MutationResult) => report(onResult, result))
  );
  const wrapped = (sink: Sink<MutationResult>): void => piped(sink);
  const settled = (): Promise<MutationResult> => pipe(wrapped, filter(isSettled), take(1), toPromise);
  return Object.assign(wrapped, {
    toPromise: settled,
    then: ((resolve, reject) => settled().then(resolve, reject)) as PromiseLike<MutationResult>['then'],
    subscribe: (callback: (result: MutationResult) => void) => subscribe(callback)(wrapped),
  });
}

export function tapMutations(client: QueryClient, onResult: (result: MutationResult) => void): boolean {
  if (tapping.has(client)) return true;
  const original = client.executeMutation.bind(client);
  try {
    client.executeMutation = (request, options) => {
      const source = original(request, options);
      return typeof source === 'function' ? tap(source as (sink: Sink<MutationResult>) => void, onResult) : source;
    };
  } catch {
    return false;
  }
  tapping.add(client);
  return true;
}
