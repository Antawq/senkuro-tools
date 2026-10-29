import { makeOperation, makeResult, type Exchange, type Operation, type OperationContext, type OperationResult } from '@urql/core';
import { filter, makeSubject, map, merge, pipe, share } from 'wonka';

import { isSettled } from '../shared/urql-result';
import { listScopeOf, listVariablesOf } from './list-families';
import type { PriceViews } from './price-views';

const isViewList = (operation: Operation): boolean => {
  const variables = listVariablesOf(operation);
  return variables !== null && listScopeOf(variables) !== null;
};

export function priceExchange(views: PriceViews, isSilent: (context: OperationContext) => boolean): Exchange {
  return ({ forward }) =>
    (operations$) => {
      const answers = makeSubject<OperationResult>();
      const releases = makeSubject<Operation>();
      const heldKeys = new Set<number>();

      const answer = (operation: Operation): boolean => {
        const data = views.answer(operation);
        if (!data) return false;
        if (heldKeys.delete(operation.key)) releases.next(makeOperation('teardown', operation, operation.context));
        answers.next(makeResult(operation, { data }));
        return true;
      };

      const route = (operation: Operation): Operation | null => {
        if (operation.kind === 'teardown') {
          heldKeys.delete(operation.key);
          return operation;
        }
        if (!isViewList(operation)) return operation;
        const isReplay = isSilent(operation.context);
        if (!isReplay) views.watch(operation);
        if (!isReplay && answer(operation)) return null;
        heldKeys.add(operation.key);
        return views.forwarded(operation);
      };

      const answered = (result: OperationResult): OperationResult => {
        if (result.operation.kind === 'mutation') {
          if (isSettled(result)) views.handleMutation(result);
          return result;
        }
        const data = isViewList(result.operation) ? views.answer(result.operation) : null;
        return data ? { ...makeResult(result.operation, { data }), stale: result.stale } : result;
      };

      const forwarded$ = pipe(
        share(operations$),
        map(route),
        filter((operation): operation is Operation => operation !== null)
      );

      return merge([pipe(forward(merge([forwarded$, releases.source])), map(answered)), answers.source]);
    };
}
