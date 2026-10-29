import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';
import { Client, gql, makeResult, type Exchange, type Operation } from '@urql/core';
import { filter, fromArray, fromPromise, mergeMap, pipe } from 'wonka';

import { installInventoryGuard } from '../utils/inventory/inventory-guard';
import type { Variables } from '../utils/inventory/list-families';
import { installClientSwap } from '../utils/shared/client-swap';
import { TRADES_EVENT, installCapture, type Capture } from '../utils/trades/trade-capture';

const GRAPHQL = 'https://api.senkuro.me/graphql';

interface SwapModules {
  installClientSwap: typeof installClientSwap;
  installInventoryGuard: typeof installInventoryGuard;
}

type InstallCapture = typeof installCapture;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const LIST = gql`
  query fetchUserCards($userId: ID!) {
    userCards(first: 20, userId: $userId) {
      edges {
        node {
          modifier
        }
      }
    }
  }
`;

const ACCEPT = gql`
  mutation acceptCardTrade($id: ID!) {
    acceptCardTrade(id: $id) {
      success
    }
  }
`;

const reinjectedSwap = async (): Promise<SwapModules> => {
  vi.resetModules();
  const [swap, guard] = await Promise.all([import('../utils/shared/client-swap'), import('../utils/inventory/inventory-guard')]);
  return { installClientSwap: swap.installClientSwap, installInventoryGuard: guard.installInventoryGuard };
};

const reinjectedCapture = async (): Promise<InstallCapture> => {
  vi.resetModules();
  return (await import('../utils/trades/trade-capture')).installCapture;
};

const page = { data: { userCards: { pageInfo: { endCursor: 'c1', hasNextPage: false }, edges: [{ node: { modifier: 0, card: { id: 'c1' } } }] } } };

const swappedPage = (installs: SwapModules[]) => {
  const pageWindow = new Window({ url: 'https://senkuro.me/forge/split' });
  pageWindow.document.body.innerHTML = '<div id="app"></div>';
  const refreshes: Variables[] = [];
  pageWindow.fetch = (() => Promise.resolve(new Response(JSON.stringify(page)))) as unknown as typeof pageWindow.fetch;
  const site: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation: Operation) => operation.kind !== 'teardown'),
      mergeMap((operation: Operation) => {
        if (operation.kind === 'mutation') return fromArray([makeResult(operation, { data: { acceptCardTrade: { success: true } } })]);
        const sendFetch = operation.context.fetch;
        if (typeof sendFetch !== 'function') return fromArray([makeResult(operation, { data: page.data })]);
        refreshes.push(operation.variables as Variables);
        return fromPromise(sendFetch(GRAPHQL, { method: 'POST', body: '{}' }).then(() => makeResult(operation, { data: page.data })));
      })
    );
  const clientRef = { __v_isRef: true, value: new Client({ url: GRAPHQL, exchanges: [site] }) as unknown };
  const typed = pageWindow as unknown as Parameters<typeof installClientSwap>[0];
  installs.forEach((modules) =>
    modules.installClientSwap(typed, () => {
      const inventory = modules.installInventoryGuard(typed);
      return { exchangesFor: () => inventory.exchanges, onSwapped: inventory.attach };
    })
  );
  (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: clientRef } } };
  const client = clientRef.value as Client;
  return { pageWindow, refreshes, client };
};

const refreshesAfterTrade = async (installs: SwapModules[]): Promise<number> => {
  const { pageWindow, refreshes, client } = swappedPage(installs);
  client.query(LIST, { userId: 'USER:1' }).subscribe(() => undefined);
  await client.mutation(ACCEPT, { id: 't1' }).toPromise();
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

describe('client swap re-injection', () => {
  it('refreshes a recorded list once after an accepted trade when installed once', async () => {
    expect(await refreshesAfterTrade([{ installClientSwap, installInventoryGuard }])).toBe(1);
  });

  it('ignores a re-injection into the same page, so an accepted trade refreshes each list only once', async () => {
    const again = await reinjectedSwap();
    expect(again.installClientSwap).not.toBe(installClientSwap);
    const single = await refreshesAfterTrade([{ installClientSwap, installInventoryGuard }]);
    const double = await refreshesAfterTrade([{ installClientSwap, installInventoryGuard }, again]);
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
