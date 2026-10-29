import type { Client, Exchange, Operation, OperationContext, OperationResult } from '@urql/core';
import { pipe, tap } from 'wonka';

import { callerContextOf, defaultContextOf } from '../shared/delegate-exchange';
import { isSettled } from '../shared/urql-result';
import { hasCursor, listVariablesOf, type PageRequest } from './list-families';

const POLICY_OPTION = 'requestPolicy';
const CACHE_HIT = 'hit';

export interface InventoryHost {
  isSilent: (context: OperationContext) => boolean;
  record: (page: PageRequest) => boolean;
  handleCacheHit: (page: PageRequest) => void;
  handleMutation: (result: OperationResult) => void;
}

interface InventoryWatch {
  host: InventoryHost;
  client: Client;
  defaults: OperationContext | null;
  firstPagesByKey: Map<number, PageRequest>;
}

const withoutPolicy = (context: Partial<OperationContext>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(context).filter(([name]) => name !== POLICY_OPTION));

const guarded =
  <T>(handle: (input: T) => void) =>
  (input: T): void => {
    try {
      handle(input);
    } catch {
      return;
    }
  };

function watchOperation(watch: InventoryWatch, operation: Operation): void {
  watch.firstPagesByKey.delete(operation.key);
  const variables = listVariablesOf(operation);
  if (!variables || watch.host.isSilent(operation.context)) return;
  watch.defaults ??= defaultContextOf(watch.client);
  const page: PageRequest = { document: operation.query, variables, options: withoutPolicy(callerContextOf(operation.context, watch.defaults)) };
  const isRevisit = watch.host.record(page);
  if (isRevisit && !hasCursor(variables)) watch.firstPagesByKey.set(operation.key, page);
}

function watchResult(watch: InventoryWatch, result: OperationResult): void {
  if (!isSettled(result)) return;
  if (result.operation.kind === 'mutation') return watch.host.handleMutation(result);
  const page = watch.firstPagesByKey.get(result.operation.key);
  if (!page) return;
  watch.firstPagesByKey.delete(result.operation.key);
  if (result.operation.context.meta?.cacheOutcome === CACHE_HIT) watch.host.handleCacheHit(page);
}

export function inventoryExchange(host: InventoryHost): Exchange {
  return ({ client, forward }) =>
    (operations$) => {
      const watch: InventoryWatch = { host, client, defaults: null, firstPagesByKey: new Map() };
      return pipe(
        forward(pipe(operations$, tap(guarded((operation: Operation) => watchOperation(watch, operation))))),
        tap(guarded((result: OperationResult) => watchResult(watch, result)))
      );
    };
}
