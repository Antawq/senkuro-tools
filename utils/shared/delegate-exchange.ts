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

export function delegateExchange(siteClient: Client, onRekey: (operation: Operation) => void = () => undefined): Exchange {
  return ({ client }) =>
    (operations$) =>
      make<OperationResult>((observer) => {
        let defaults: OperationContext | null = null;
        const queries = new Map<number, HeldQuery>();
        const mutations = new Set<Subscription>();

        const siteSourceOf = (operation: Operation): OperationResultSource<OperationResult> => {
          defaults ??= defaultContextOf(client);
          const request = siteRequestOf(operation);
          if (request.key !== operation.key) onRekey(operation);
          const context = callerContextOf(operation.context, defaults);
          if (operation.kind === 'mutation') return siteClient.executeMutation(request, context);
          if (operation.kind === 'subscription') return siteClient.executeSubscription(request, context);
          return siteClient.executeQuery(request, context);
        };

        const startMutation = (operation: Operation): void => {
          let isSettled = false;
          let subscription: Subscription | null = null;
          subscription = siteSourceOf(operation).subscribe((siteResult) => {
            observer.next(mappedResult(operation, siteResult));
            if (siteResult.hasNext) return;
            isSettled = true;
            if (subscription) mutations.delete(subscription);
          });
          if (!isSettled) mutations.add(subscription);
        };

        const startQuery = (operation: Operation): void => {
          const previous = queries.get(operation.key);
          if (previous) previous.isLive = false;
          const held: HeldQuery = { isLive: true, subscription: null };
          queries.set(operation.key, held);
          held.subscription = siteSourceOf(operation).subscribe((siteResult) => {
            if (held.isLive) observer.next(mappedResult(operation, siteResult));
          });
          previous?.subscription?.unsubscribe();
        };

        const release = (key: number): void => {
          const held = queries.get(key);
          if (!held) return;
          held.isLive = false;
          queries.delete(key);
          held.subscription?.unsubscribe();
        };

        const input = pipe(
          operations$,
          subscribe((operation: Operation) => {
            if (operation.kind === 'teardown') release(operation.key);
            else if (operation.kind === 'mutation') startMutation(operation);
            else startQuery(operation);
          })
        );

        return () => {
          input.unsubscribe();
          [...queries.keys()].forEach(release);
          mutations.forEach((subscription) => subscription.unsubscribe());
          mutations.clear();
        };
      });
}
