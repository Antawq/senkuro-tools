import type { Exchange, Operation, OperationContext, OperationResult } from '@urql/core';
import { pipe, tap } from 'wonka';

import { callerContextOf, defaultContextOf } from '../shared/delegate-exchange';
import { isSettled } from '../shared/urql-source';
import { hasCursor, listVariablesOf, type PageRequest } from './list-families';

const POLICY_OPTION = 'requestPolicy';
const CACHE_HIT = 'hit';

export interface InventoryHost {
  isSilent: (context: OperationContext) => boolean;
  record: (page: PageRequest) => boolean;
  handleCacheHit: (page: PageRequest) => void;
  handleMutation: (result: OperationResult) => void;
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

export function inventoryExchange(host: InventoryHost): Exchange {
  return ({ client, forward }) =>
    (operations$) => {
      const firstPagesByKey = new Map<number, PageRequest>();
      let defaults: OperationContext | null = null;

      const handleOperation = (operation: Operation): void => {
        firstPagesByKey.delete(operation.key);
        const variables = listVariablesOf(operation);
        if (!variables || host.isSilent(operation.context)) return;
        defaults ??= defaultContextOf(client);
        const page: PageRequest = { document: operation.query, variables, options: withoutPolicy(callerContextOf(operation.context, defaults)) };
        const isRevisit = host.record(page);
        if (isRevisit && !hasCursor(variables)) firstPagesByKey.set(operation.key, page);
      };

      const handleResult = (result: OperationResult): void => {
        if (!isSettled(result)) return;
        if (result.operation.kind === 'mutation') return host.handleMutation(result);
        const page = firstPagesByKey.get(result.operation.key);
        if (!page) return;
        firstPagesByKey.delete(result.operation.key);
        if (result.operation.context.meta?.cacheOutcome === CACHE_HIT) host.handleCacheHit(page);
      };

      return pipe(forward(pipe(operations$, tap(guarded(handleOperation)))), tap(guarded(handleResult)));
    };
}
