import {
  createRequest,
  makeOperation,
  type Client,
  type Exchange,
  type GraphQLRequest,
  type Operation,
  type OperationContext,
  type OperationResult,
  type OperationResultSource,
} from '@urql/core';
import { make, pipe, subscribe } from 'wonka';

const PROBE_DOCUMENT = 'query senkutoolsProbe { __typename }';
const CLIENT_OPTION_NAMES: ReadonlySet<string> = new Set(['url', 'fetchSubscriptions', 'fetchOptions', 'fetch', 'preferGetMethod', 'suspense']);
const RESULT_CONTEXT_NAMES: ReadonlySet<string> = new Set(['_instance', 'meta']);

type CallerContext = Partial<OperationContext>;

interface Subscription {
  unsubscribe(): void;
}

interface HeldQuery {
  isLive: boolean;
  subscription: Subscription | null;
}

export const defaultContextOf = (client: Client): OperationContext => client.createRequestOperation('query', createRequest(PROBE_DOCUMENT, {})).context;

export function callerContextOf(context: OperationContext, defaults: OperationContext): CallerContext {
  const callerContext: CallerContext & Record<string, unknown> = {};
  for (const [name, option] of Object.entries(context) as [string, unknown][]) {
    if (option === undefined || RESULT_CONTEXT_NAMES.has(name)) continue;
    if (CLIENT_OPTION_NAMES.has(name) && defaults[name as keyof OperationContext] === option) continue;
    callerContext[name] = option;
  }
  return callerContext;
}

function siteRequestOf(operation: Operation): GraphQLRequest {
  const request = createRequest(operation.query, operation.variables, operation.extensions);
  if (request.key !== operation.key) return request;
  return { key: operation.key, query: operation.query, variables: operation.variables, extensions: operation.extensions };
}

const mappedResult = (operation: Operation, siteResult: OperationResult): OperationResult => {
  const meta = siteResult.operation.context.meta;
  return { ...siteResult, operation: meta ? makeOperation(operation.kind, operation, { ...operation.context, meta }) : operation };
};

interface Delegate {
  siteClient: Client;
  client: Client;
  onRekey: (operation: Operation) => void;
  deliver: (result: OperationResult) => void;
  defaults: OperationContext | null;
  queries: Map<number, HeldQuery>;
}

function siteSourceOf(delegate: Delegate, operation: Operation): OperationResultSource<OperationResult> {
  delegate.defaults ??= defaultContextOf(delegate.client);
  const request = siteRequestOf(operation);
  if (request.key !== operation.key) delegate.onRekey(operation);
  const context = callerContextOf(operation.context, delegate.defaults);
  if (operation.kind === 'mutation') return delegate.siteClient.executeMutation(request, context);
  if (operation.kind === 'subscription') return delegate.siteClient.executeSubscription(request, context);
  return delegate.siteClient.executeQuery(request, context);
}

function startMutation(delegate: Delegate, operation: Operation): void {
  siteSourceOf(delegate, operation).subscribe((siteResult) => delegate.deliver(mappedResult(operation, siteResult)));
}

function startQuery(delegate: Delegate, operation: Operation): void {
  const previous = delegate.queries.get(operation.key);
  if (previous) previous.isLive = false;
  const held: HeldQuery = { isLive: true, subscription: null };
  delegate.queries.set(operation.key, held);
  held.subscription = siteSourceOf(delegate, operation).subscribe((siteResult) => {
    if (held.isLive) delegate.deliver(mappedResult(operation, siteResult));
  });
  if (!held.isLive) held.subscription.unsubscribe();
  previous?.subscription?.unsubscribe();
}

function release(delegate: Delegate, key: number): void {
  const held = delegate.queries.get(key);
  if (!held) return;
  held.isLive = false;
  delegate.queries.delete(key);
  held.subscription?.unsubscribe();
}

function handleOperation(delegate: Delegate, operation: Operation): void {
  if (operation.kind === 'teardown') release(delegate, operation.key);
  else if (operation.kind === 'mutation') startMutation(delegate, operation);
  else startQuery(delegate, operation);
}

export function delegateExchange(siteClient: Client, onRekey: (operation: Operation) => void = () => undefined): Exchange {
  return ({ client }) =>
    (operations$) =>
      make<OperationResult>((observer) => {
        const delegate: Delegate = {
          siteClient,
          client,
          onRekey,
          deliver: (result) => observer.next(result),
          defaults: null,
          queries: new Map(),
        };
        const input = pipe(
          operations$,
          subscribe((operation: Operation) => handleOperation(delegate, operation))
        );
        return () => input.unsubscribe();
      });
}
