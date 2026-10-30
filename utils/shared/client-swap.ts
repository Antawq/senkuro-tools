import { Client, getOperationName, type Exchange } from '@urql/core';

import { runAfterHydration } from './app-mounted';
import { debugLogger } from './debug';
import { defaultContextOf, delegateExchange } from './delegate-exchange';
import { claimPage, isPageClaimed } from './page-claim';
import type { PageWindow } from './page-window';
import type { VueApp } from './vue-app';

const CLIENT_KEY = '$urql';
const CLIENT_METHODS = ['executeQuery', 'executeMutation', 'executeSubscription', 'createRequestOperation'];
const OLDER_VERSION_CLAIMS = ['search-request', 'catalog-search', 'inventory-guard', 'urql-waiting'];

interface ClientRef {
  __v_isRef?: unknown;
  value: unknown;
}

export interface SwapHost {
  exchangesFor: (siteClient: Client) => Exchange[];
  onSwapped?: (client: Client, siteClient: Client) => void;
}

type Debug = (...details: unknown[]) => void;

const isClient = (candidate: unknown): candidate is Client =>
  CLIENT_METHODS.every((name) => typeof (candidate as Record<string, unknown> | null)?.[name] === 'function');

export function findClientRef(app: VueApp): ClientRef | null {
  const provided = app._context?.provides?.[CLIENT_KEY] as ClientRef | null | undefined;
  return provided?.__v_isRef === true && isClient(provided.value) ? provided : null;
}

function siteUrlOf(siteClient: Client): string | null {
  const url: unknown = defaultContextOf(siteClient).url;
  return typeof url === 'string' && url !== '' ? url : null;
}

export function swapClient(app: VueApp, host: SwapHost, debug: Debug = () => undefined): Client | null {
  const clientRef = findClientRef(app);
  const siteClient = clientRef?.value as Client | undefined;
  const url = siteClient ? siteUrlOf(siteClient) : null;
  if (!clientRef || !siteClient || !url) {
    debug('client not swapped', { hasClient: siteClient !== undefined, hasUrl: url !== null });
    return null;
  }
  const exchanges = [
    ...host.exchangesFor(siteClient),
    delegateExchange(siteClient, (operation) => debug('site request re-keyed', getOperationName(operation.query))),
  ];
  const client = new Client({ url, requestPolicy: defaultContextOf(siteClient).requestPolicy, suspense: true, exchanges });
  clientRef.value = client;
  if (clientRef.value !== client) {
    debug('client not swapped', { isReadonly: true });
    return null;
  }
  debug('client swapped');
  host.onSwapped?.(client, siteClient);
  return client;
}

export function installClientSwap(pageWindow: PageWindow, createHost: () => SwapHost): void {
  const debug = debugLogger(pageWindow);
  if (OLDER_VERSION_CLAIMS.some((name) => isPageClaimed(pageWindow, name))) {
    debug('client not swapped', { olderVersion: true });
    return;
  }
  if (!claimPage(pageWindow, 'client-swap')) return;
  const host = createHost();
  runAfterHydration(pageWindow, (app) => {
    try {
      swapClient(app, host, debug);
    } catch (error) {
      reportError(error);
    }
  });
}
