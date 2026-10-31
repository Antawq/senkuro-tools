import type { Operation, OperationResult } from '@urql/core';

import type { ListScope } from '../shared/list-scope';
import type { PriceOrder, PriceRows, PriceState, ViewSort } from '../shared/price-signal';
import { listScopeOf } from './list-families';
import { createPriceView, createViewCounters, type PageAnswer, type PriceView, type ViewHost } from './price-view';

export interface ViewsHost extends Omit<ViewHost, 'publishState' | 'publishRows'> {
  publishState: (scope: ListScope, state: PriceState) => void;
  publishRows: (scope: ListScope, rows: PriceRows) => void;
}

export interface PriceViews {
  watch: (operation: Operation) => void;
  answer: (operation: Operation) => PageAnswer | null;
  forwarded: (operation: Operation) => Operation;
  start: (scope: ListScope, sort: ViewSort) => void;
  stop: (scope: ListScope) => void;
  restart: (scope: ListScope) => void;
  receiveOrder: (scope: ListScope, order: PriceOrder) => void;
  handleMutation: (result: OperationResult) => void;
}

type ViewsByScope = Record<ListScope, PriceView>;

const scopedHost = (host: ViewsHost, scope: ListScope): ViewHost => ({
  ...host,
  publishState: (state) => host.publishState(scope, state),
  publishRows: (rows) => host.publishRows(scope, rows),
});

function createViewsByScope(host: ViewsHost): ViewsByScope {
  const counters = createViewCounters();
  const viewFor = (scope: ListScope): PriceView => createPriceView(scopedHost(host, scope), { scope, counters });
  return { grid: viewFor('grid'), picker: viewFor('picker') };
}

function viewOf(views: ViewsByScope, operation: Operation): PriceView | null {
  const scope = listScopeOf(operation.variables ?? {});
  return scope ? views[scope] : null;
}

export function createPriceViews(host: ViewsHost): PriceViews {
  const views = createViewsByScope(host);
  return {
    watch: (operation) => viewOf(views, operation)?.watch(operation),
    answer: (operation) => viewOf(views, operation)?.answer(operation) ?? null,
    forwarded: (operation) => viewOf(views, operation)?.forwarded(operation) ?? operation,
    start: (scope, sort) => views[scope].start(sort),
    stop: (scope) => views[scope].stop(),
    restart: (scope) => views[scope].restart(),
    receiveOrder: (scope, order) => views[scope].receiveOrder(order),
    handleMutation: (result) => Object.values(views).forEach((view) => view.handleMutation(result)),
  };
}
