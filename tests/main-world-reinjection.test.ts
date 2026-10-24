import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';
import { make } from 'wonka';

import type { MutationResult } from '../utils/inventory/client-hooks';
import { installInventoryGuard } from '../utils/inventory/inventory-guard';
import { LIST_OPERATION, type Variables } from '../utils/inventory/list-families';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';
import { TRADES_EVENT, installCapture, type Capture } from '../utils/trades/trade-capture';

const GRAPHQL = 'https://api.senkuro.me/graphql';

type InstallGuard = typeof installInventoryGuard;
type InstallCapture = typeof installCapture;
type Init = NonNullable<Parameters<Window['fetch']>[1]>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const reinjectedGuard = async (): Promise<InstallGuard> => {
  vi.resetModules();
  return (await import('../utils/inventory/inventory-guard')).installInventoryGuard;
};

const reinjectedCapture = async (): Promise<InstallCapture> => {
  vi.resetModules();
  return (await import('../utils/trades/trade-capture')).installCapture;
};

const request = (name: string, variables: Variables = {}): QueryRequest => ({
  key: 1,
  variables,
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: name } }] },
});

const acceptedTrade: MutationResult = { operation: request('acceptCardTrade'), data: { acceptCardTrade: { success: true } } };

const page = { data: { userCards: { pageInfo: { endCursor: 'c1', hasNextPage: false }, edges: [{ node: { modifier: 0, card: { id: 'c1' } } }] } } };

const guardedPage = (installs: InstallGuard[]) => {
  const pageWindow = new Window({ url: 'https://senkuro.me/forge/split' });
  pageWindow.document.body.innerHTML = '<div id="app"></div>';
  const refreshes: Variables[] = [];
  const pending = [acceptedTrade];
  const client: QueryClient = {
    executeQuery: () => null,
    executeMutation: () =>
      make<MutationResult>((observer) => {
        const next = pending.shift();
        if (next) observer.next(next);
        observer.complete();
        return () => undefined;
      }),
    query: (_document, variables, options = {}) => ({
      toPromise: async () => {
        refreshes.push(variables);
        await (options.fetch as (input: string, init: Init) => Promise<Response>)(GRAPHQL, {
          method: 'POST',
          body: JSON.stringify({ operationName: LIST_OPERATION, variables }),
        });
        return {};
      },
    }),
  };
  pageWindow.fetch = (() => Promise.resolve(new Response(JSON.stringify(page)))) as unknown as typeof pageWindow.fetch;
  (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: { value: client } } } };
  installs.forEach((install) => install(pageWindow as unknown as Parameters<InstallGuard>[0]));
  const respond = () => pageWindow.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: 'fetchViewer' }) });
  const browse = (variables: Variables) => client.executeQuery(request(LIST_OPERATION, variables));
  const mutate = (name: string) => (client.executeMutation(request(name)) as { toPromise(): Promise<MutationResult> }).toPromise();
  return { pageWindow, refreshes, respond, browse, mutate };
};

const refreshesAfterTrade = async (installs: InstallGuard[]): Promise<number> => {
  const { pageWindow, refreshes, respond, browse, mutate } = guardedPage(installs);
  await respond();
  browse({ userId: 'USER:1' });
  await mutate('acceptCardTrade');
  await settle();
  await pageWindow.happyDOM.close();
  return refreshes.length;
};

const preview = (slug: string) => ({
  __typename: 'CardPreview',
  modifier: 0,
  quantity: 1,
  shard: false,
  card: { __typename: 'Card', id: slug, slug, rank: 'F' },
});
const user = (id: string, name: string) => ({ __typename: 'User', id, slug: id, name });

const trade = {
  __typename: 'CardTrade',
  id: 't1',
  createdAt: '2026-10-17T18:31:05.923657',
  source: user('u1', 'Phaivroh | WL'),
  destination: user('u2', 'Smile'),
  offer: [preview('a')],
  request: [preview('b')],
};

const eventsPerAnswer = async (installs: InstallCapture[]): Promise<number> => {
  const pageWindow = new Window({ url: 'https://senkuro.me/notifications/all' });
  pageWindow.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: { cardTrade: trade } }), { headers: { 'content-type': 'application/json' } })
    )) as unknown as typeof pageWindow.fetch;
  const seen: Capture[] = [];
  pageWindow.document.addEventListener(TRADES_EVENT, (event) => seen.push(JSON.parse((event as unknown as CustomEvent<string>).detail) as Capture));
  installs.forEach((install) => install(pageWindow as unknown as Parameters<InstallCapture>[0]));
  await (await pageWindow.fetch(GRAPHQL, { method: 'POST' })).json();
  await settle();
  await pageWindow.happyDOM.close();
  return seen.length;
};

describe('inventory guard re-injection', () => {
  it('refreshes a recorded list once after an accepted trade when installed once', async () => {
    expect(await refreshesAfterTrade([installInventoryGuard])).toBe(1);
  });

  it('ignores a re-injection into the same page, so an accepted trade refreshes each list only once', async () => {
    const again = await reinjectedGuard();
    expect(again).not.toBe(installInventoryGuard);
    const single = await refreshesAfterTrade([installInventoryGuard]);
    const double = await refreshesAfterTrade([installInventoryGuard, again]);
    expect(single).toBeGreaterThan(0);
    expect(double).toBe(single);
  });
});

describe('trade capture re-injection', () => {
  it('emits one trades event per GraphQL answer when installed once', async () => {
    expect(await eventsPerAnswer([installCapture])).toBe(1);
  });

  it('ignores a re-injection into the same page, so each GraphQL answer emits one trades event', async () => {
    const again = await reinjectedCapture();
    expect(again).not.toBe(installCapture);
    const single = await eventsPerAnswer([installCapture]);
    const double = await eventsPerAnswer([installCapture, again]);
    expect(single).toBeGreaterThan(0);
    expect(double).toBe(single);
  });
});
