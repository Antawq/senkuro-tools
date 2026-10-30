import { makeOperation, makeResult, type Exchange, type Operation, type OperationContext, type OperationResult } from '@urql/core';
import { filter, makeSubject, map, merge, pipe, share, tap, type Subject } from 'wonka';

import { isSettled } from '../shared/urql-result';
import { listScopeOf, listVariablesOf } from './list-families';
import type { PriceViews } from './price-views';

interface PriceRoute {
  views: PriceViews;
  isSilent: (context: OperationContext) => boolean;
  answers: Subject<OperationResult>;
  releases: Subject<Operation>;
  heldKeys: Set<number>;
}

const isViewList = (operation: Operation): boolean => {
  const variables = listVariablesOf(operation);
  return variables !== null && listScopeOf(variables) !== null;
};

function answer(route: PriceRoute, operation: Operation): boolean {
  const data = route.views.answer(operation);
  if (!data) return false;
  if (route.heldKeys.delete(operation.key)) route.releases.next(makeOperation('teardown', operation, operation.context));
  route.answers.next(makeResult(operation, { data }));
  return true;
}

function routeOperation(route: PriceRoute, operation: Operation): Operation | null {
  if (operation.kind === 'teardown') {
    route.heldKeys.delete(operation.key);
    return operation;
  }
  if (!isViewList(operation)) return operation;
  const isReplay = route.isSilent(operation.context);
  if (!isReplay) route.views.watch(operation);
  if (!isReplay && answer(route, operation)) return null;
  route.heldKeys.add(operation.key);
  return route.views.forwarded(operation);
}

function noteSettledMutation(views: PriceViews, result: OperationResult): void {
  if (result.operation.kind === 'mutation' && isSettled(result)) views.handleMutation(result);
}

function answerServedList(views: PriceViews, result: OperationResult): OperationResult {
  const data = isViewList(result.operation) ? views.answer(result.operation) : null;
  return data ? { ...makeResult(result.operation, { data }), stale: result.stale } : result;
}

export function priceExchange(views: PriceViews, isSilent: (context: OperationContext) => boolean): Exchange {
  return ({ forward }) =>
    (operations$) => {
      const route: PriceRoute = { views, isSilent, answers: makeSubject(), releases: makeSubject(), heldKeys: new Set() };
      const forwarded$ = pipe(
        share(operations$),
        map((operation: Operation) => routeOperation(route, operation)),
        filter((operation): operation is Operation => operation !== null)
      );
      const results$ = pipe(
        forward(merge([forwarded$, route.releases.source])),
        tap((result: OperationResult) => noteSettledMutation(views, result)),
        map((result: OperationResult) => answerServedList(views, result))
      );
      return merge([results$, route.answers.source]);
    };
}
