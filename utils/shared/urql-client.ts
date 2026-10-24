import type { PageWindow } from './page-window';
import { findVueApp, VUE_APP_KEY } from './vue-app';

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
  createRequestOperation?(kind: string, request: QueryRequest, options?: Record<string, unknown>): unknown;
  reexecuteOperation?(operation: unknown): void;
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

function claimClient(pageWindow: PageWindow, waiting: Waiting): void {
  if (waiting.client) return;
  const client = findClient(pageWindow.document);
  if (!client) return;
  waiting.client = client;
  for (const run of waiting.listeners.splice(0)) {
    try {
      run(client);
    } catch (error) {
      reportError(error);
    }
  }
}

function watchApp(pageWindow: PageWindow, claim: () => void): void {
  const prototype = pageWindow.Element.prototype;
  const previous = Object.getOwnPropertyDescriptor(prototype, VUE_APP_KEY);
  Object.defineProperty(prototype, VUE_APP_KEY, {
    configurable: true,
    set(this: Element, app: unknown) {
      previous?.set?.call(this, app);
      Object.defineProperty(this, VUE_APP_KEY, { value: app, writable: true, configurable: true, enumerable: true });
      claim();
    },
  });
}

function watchFetch(pageWindow: PageWindow, waiting: Waiting, claim: () => void): void {
  const nativeFetch = pageWindow.fetch.bind(pageWindow);
  pageWindow.fetch = (...fetchArguments: Parameters<typeof fetch>) => {
    const pendingResponse = nativeFetch(...fetchArguments);
    if (!waiting.client) void pendingResponse.then(claim, () => undefined);
    return pendingResponse;
  };
}

export function runWhenClientFound(pageWindow: PageWindow, run: (client: QueryClient) => void): void {
  const windowSlots = pageWindow as unknown as Record<symbol, Waiting | undefined>;
  let waiting = windowSlots[WAITING];
  if (!waiting) {
    const created: Waiting = { client: null, listeners: [] };
    waiting = created;
    windowSlots[WAITING] = created;
    const claim = () => claimClient(pageWindow, created);
    watchApp(pageWindow, claim);
    watchFetch(pageWindow, created, claim);
  }
  if (waiting.client) run(waiting.client);
  else waiting.listeners.push(run);
}
