import { afterEach, describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';
import { Client, gql, type Exchange, type Operation } from '@urql/core';
import { pipe, tap } from 'wonka';

import { findClientRef, installClientSwap, swapClient, type SwapHost } from '../utils/shared/client-swap';
import { createSiteClient, tick } from './helpers/site-client';

type PageWindow = Parameters<typeof installClientSwap>[0];

const VIEWER = gql`
  query fetchViewer {
    viewer {
      id
    }
  }
`;

const siteHooks = () => {
  const handlers = new Map<string, (() => void)[]>();
  return {
    on: (event: string, handler: () => void) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    off: (event: string, handler: () => void) =>
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((known) => known !== handler)
      ),
    emit: (event: string) => (handlers.get(event) ?? []).slice().forEach((handler) => handler()),
  };
};

const clientRef = (client: unknown) => ({ __v_isRef: true, value: client });

const appWith = (provided: unknown, senkuro?: unknown) => ({ _context: { provides: { $urql: provided } }, ...(senkuro ? { $senkuro: senkuro } : {}) });

const host = (exchanges: Exchange[] = []): SwapHost & { swapped: Client[] } => {
  const swapped: Client[] = [];
  return { exchangesFor: () => exchanges, onSwapped: (client) => void swapped.push(client), swapped };
};

const openPage = () => {
  const pageWindow = new Window({ url: 'https://senkuro.me/users/sena/cards' });
  pageWindow.document.body.innerHTML = '<div id="app"></div>';
  const mount = (app: unknown) => {
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = app;
  };
  return { pageWindow: pageWindow as unknown as PageWindow, mount, close: () => pageWindow.happyDOM.close() };
};

describe('swapClient', () => {
  it('puts a client of its own into the ref the site provides, with the feature exchanges in front of the site client', async () => {
    const site = createSiteClient(() => ({ data: { viewer: { id: 'U1' } } }));
    const seen: string[] = [];
    const watching: Exchange =
      ({ forward }) =>
      (operations$) =>
        forward(
          pipe(
            operations$,
            tap((operation: Operation) => void seen.push(operation.kind))
          )
        );
    const swapHost = host([watching]);
    const ref = clientRef(site.client);
    const swapped = swapClient(appWith(ref), swapHost);
    expect(swapped).toBeInstanceOf(Client);
    expect(ref.value).toBe(swapped);
    expect(swapHost.swapped).toEqual([swapped]);
    const result = await swapped!.query(VIEWER, {}).toPromise();
    expect(result.data).toEqual({ viewer: { id: 'U1' } });
    expect(seen).toContain('query');
    expect(site.operations.filter((operation) => operation.kind === 'query')).toHaveLength(1);
    await tick();
  });

  it('asks the site with its own default request policy when the caller names none', async () => {
    const site = createSiteClient(() => ({ data: { viewer: { id: 'U1' } } }), { requestPolicy: 'cache-and-network' });
    const swapped = swapClient(appWith(clientRef(site.client)), host());
    await swapped!.query(VIEWER, {}).toPromise();
    await tick();
    expect(site.operations.filter((operation) => operation.kind === 'query').map((operation) => operation.context.requestPolicy)).toEqual([
      'cache-and-network',
    ]);
  });

  it('leaves the site as it is when the provide is not a ref, holds no client, or the client names no address', () => {
    const site = createSiteClient(() => null);
    const noUrl = { ...site.client, createRequestOperation: () => ({ context: { url: '' } }) };
    for (const provided of [site.client, clientRef(null), clientRef({ executeQuery: () => null }), clientRef(noUrl), undefined]) {
      const swapHost = host();
      expect(swapClient(appWith(provided), swapHost)).toBeNull();
      expect(swapHost.swapped).toEqual([]);
    }
    expect(swapClient({}, host())).toBeNull();
  });

  it('counts a ref that keeps its old value as no swap', () => {
    const site = createSiteClient(() => null);
    const readonlyRef = {
      __v_isRef: true,
      get value() {
        return site.client;
      },
      set value(_ignored: unknown) {},
    };
    const swapHost = host();
    expect(swapClient(appWith(readonlyRef), swapHost)).toBeNull();
    expect(swapHost.swapped).toEqual([]);
  });
});

describe('findClientRef', () => {
  it('finds only a ref that holds a client with the four methods the delegate calls', () => {
    const site = createSiteClient(() => null);
    const ref = clientRef(site.client);
    expect(findClientRef(appWith(ref))).toBe(ref);
    expect(findClientRef(appWith(clientRef({ ...site.client, executeSubscription: undefined })))).toBeNull();
  });
});

describe('installClientSwap', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('swaps only after the site has finished hydrating its page, and once per page', async () => {
    const { pageWindow, mount, close } = openPage();
    const site = createSiteClient(() => null);
    const hooks = siteHooks();
    const ref = clientRef(site.client);
    const swapHost = host();
    installClientSwap(pageWindow, () => swapHost);
    installClientSwap(pageWindow, () => swapHost);
    mount(appWith(ref, { hydrating: true, hooks }));
    expect(ref.value).toBe(site.client);
    hooks.emit('app:suspense:resolve');
    expect(ref.value).toBeInstanceOf(Client);
    expect(ref.value).not.toBe(site.client);
    expect(swapHost.swapped).toHaveLength(1);
    await close();
  });

  it('swaps at once in a page whose app was mounted and hydrated before the script ran', async () => {
    const { pageWindow, mount, close } = openPage();
    const site = createSiteClient(() => null);
    const ref = clientRef(site.client);
    mount(appWith(ref, { hydrating: false, hooks: siteHooks() }));
    installClientSwap(pageWindow, () => host());
    expect(ref.value).toBeInstanceOf(Client);
    expect(ref.value).not.toBe(site.client);
    await close();
  });

  it('reports a failing swap and keeps the site client and the hydration handlers of the site running', async () => {
    const reported: unknown[] = [];
    vi.stubGlobal('reportError', (error: unknown) => void reported.push(error));
    const { pageWindow, mount, close } = openPage();
    const site = createSiteClient(() => null);
    const hooks = siteHooks();
    const ref = clientRef(site.client);
    const afterOurs = vi.fn();
    installClientSwap(pageWindow, () => ({
      exchangesFor: () => {
        throw new Error('boom');
      },
    }));
    mount(appWith(ref, { hydrating: true, hooks }));
    hooks.on('app:suspense:resolve', afterOurs);
    hooks.emit('app:suspense:resolve');
    expect(reported).toHaveLength(1);
    expect(ref.value).toBe(site.client);
    expect(afterOurs).toHaveBeenCalledOnce();
    await close();
  });
});
