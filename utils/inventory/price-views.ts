import type { ListScope } from '../shared/list-scope';
import type { PriceOrder, PriceRows, PriceState } from '../shared/price-signal';
import type { QueryRequest } from '../shared/urql-client';
import type { MutationResult } from './client-hooks';
import { listScopeOf, type Variables } from './list-families';
import { createPriceView, createViewCounters, emptyAnswer, type PageAnswer, type PriceView, type ViewHost } from './price-view';

export interface ViewsHost extends Omit<ViewHost, 'publishState' | 'publishRows'> {
  publishState: (scope: ListScope, state: PriceState) => void;
  publishRows: (scope: ListScope, rows: PriceRows) => void;
}

export interface PriceViews {
  watch: (request: QueryRequest, options: Record<string, unknown> | undefined) => void;
  rewrite: (request: QueryRequest) => QueryRequest;
  answer: (variables: Variables) => PageAnswer;
  start: (scope: ListScope) => void;
  stop: (scope: ListScope) => void;
  restart: (scope: ListScope) => void;
  receiveOrder: (scope: ListScope, order: PriceOrder) => void;
  handleMutation: (mutation: MutationResult) => void;
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

function viewOf(views: ViewsByScope, variables: Variables | undefined): PriceView | null {
  const scope = variables ? listScopeOf(variables) : null;
  return scope ? views[scope] : null;
}

export function createPriceViews(host: ViewsHost): PriceViews {
  const views = createViewsByScope(host);
  return {
    watch: (request, options) => viewOf(views, request.variables)?.watch(request, options),
    rewrite: (request) => viewOf(views, request.variables)?.rewrite(request) ?? request,
    answer: (variables) => viewOf(views, variables)?.answer(variables) ?? emptyAnswer(),
    start: (scope) => views[scope].start(),
    stop: (scope) => views[scope].stop(),
    restart: (scope) => views[scope].restart(),
    receiveOrder: (scope, order) => views[scope].receiveOrder(order),
    handleMutation: (mutation) => Object.values(views).forEach((view) => view.handleMutation(mutation)),
  };
}
