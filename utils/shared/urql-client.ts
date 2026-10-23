import type { PageWindow } from './page-window';

const APP_ROOT = '#app';
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
  query(document: unknown, variables: Variables, options?: Record<string, unknown>): { toPromise(): Promise<unknown> };
}

interface VueApp {
  _context?: { provides?: Record<string, unknown> };
}

interface Waiting {
  client: QueryClient | null;
  callbacks: ((client: QueryClient) => void)[];
}

export const operationName = (request: QueryRequest): string | undefined =>
  request.query?.definitions?.find((part) => part.kind === OPERATION_KIND)?.name?.value;

const isClient = (value: unknown): value is QueryClient =>
  CLIENT_METHODS.every((name) => typeof (value as Record<string, unknown> | null)?.[name] === 'function');

export function findClient(pageDocument: Document): QueryClient | null {
  const app = pageDocument.querySelector<Element & { __vue_app__?: VueApp }>(APP_ROOT)?.__vue_app__;
  const provided = app?._context?.provides?.[CLIENT_KEY];
  if (isClient(provided)) return provided;
  const inner = (provided as { value?: unknown } | null | undefined)?.value;
  return isClient(inner) ? inner : null;
}

function watch(pageWindow: PageWindow, waiting: Waiting): void {
  const nativeFetch = pageWindow.fetch.bind(pageWindow);
  pageWindow.fetch = (...args: Parameters<typeof fetch>) => {
    const pending = nativeFetch(...args);
    if (!waiting.client) {
      void pending.then(
        () => {
          if (waiting.client) return;
          const client = findClient(pageWindow.document);
          if (!client) return;
          waiting.client = client;
          waiting.callbacks.splice(0).forEach((run) => run(client));
        },
        () => undefined
      );
    }
    return pending;
  };
}

export function whenClient(pageWindow: PageWindow, run: (client: QueryClient) => void): void {
  const host = pageWindow as unknown as Record<symbol, Waiting | undefined>;
  let waiting = host[WAITING];
  if (!waiting) {
    waiting = { client: null, callbacks: [] };
    host[WAITING] = waiting;
    watch(pageWindow, waiting);
  }
  if (waiting.client) run(waiting.client);
  else waiting.callbacks.push(run);
}
