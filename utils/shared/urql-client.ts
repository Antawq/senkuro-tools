import type { PageWindow } from './page-window';
import { findVueApp } from './vue-app';

const CLIENT_KEY = '$urql';
const OPERATION_KIND = 'OperationDefinition';
const CLIENT_METHODS = ['executeQuery', 'executeMutation', 'query'];
const WAITING = Symbol.for('senkutools.urql-waiting');

type Variables = Record<string, unknown>;

export interface QueryRequest {
  key?: number;
  variables?: Variables;
  query?: { definitions?: { kind?: string; name?: { value?: string } }[] };
}

export interface QueryClient {
  executeQuery(request: QueryRequest, options?: Record<string, unknown>): unknown;
  executeMutation(request: QueryRequest, options?: Record<string, unknown>): unknown;
  query(queryDocument: unknown, variables: Variables, options?: Record<string, unknown>): { toPromise(): Promise<unknown> };
}

interface Waiting {
  client: QueryClient | null;
  listeners: ((client: QueryClient) => void)[];
}

export const operationName = (request: QueryRequest): string | undefined =>
  request.query?.definitions?.find((definition) => definition.kind === OPERATION_KIND)?.name?.value;

const isClient = (candidate: unknown): candidate is QueryClient =>
  CLIENT_METHODS.every((name) => typeof (candidate as Record<string, unknown> | null)?.[name] === 'function');

export function findClient(pageDocument: Document): QueryClient | null {
  const provided = findVueApp(pageDocument)?._context?.provides?.[CLIENT_KEY];
  if (isClient(provided)) return provided;
  const inner = (provided as { value?: unknown } | null | undefined)?.value;
  return isClient(inner) ? inner : null;
}

function watchFetch(pageWindow: PageWindow, waiting: Waiting): void {
  const nativeFetch = pageWindow.fetch.bind(pageWindow);
  pageWindow.fetch = (...fetchArguments: Parameters<typeof fetch>) => {
    const pendingResponse = nativeFetch(...fetchArguments);
    if (!waiting.client) {
      void pendingResponse.then(
        () => {
          if (waiting.client) return;
          const client = findClient(pageWindow.document);
          if (!client) return;
          waiting.client = client;
          waiting.listeners.splice(0).forEach((run) => run(client));
        },
        () => undefined
      );
    }
    return pendingResponse;
  };
}

export function runWhenClientFound(pageWindow: PageWindow, run: (client: QueryClient) => void): void {
  const windowSlots = pageWindow as unknown as Record<symbol, Waiting | undefined>;
  let waiting = windowSlots[WAITING];
  if (!waiting) {
    waiting = { client: null, listeners: [] };
    windowSlots[WAITING] = waiting;
    watchFetch(pageWindow, waiting);
  }
  if (waiting.client) run(waiting.client);
  else waiting.listeners.push(run);
}
