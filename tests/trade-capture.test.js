import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import { REPLAY_EVENT, TRADES_EVENT, captureServerPayload, captureTrades, createTradeStore, installCapture, listenForTrades } from '../utils/trade-capture.js';

const preview = (slug, quantity = 1, shard = false) => ({
  __typename: 'CardPreview',
  modifier: 0,
  quantity,
  shard,
  card: { __typename: 'Card', id: slug, slug, rank: 'F' },
});
const user = (id, name) => ({ __typename: 'User', id, slug: id, name });

const trade = {
  __typename: 'CardTrade',
  id: 't1',
  status: 'PENDING',
  source: user('u1', 'Phaivroh | WL'),
  destination: user('u2', 'Молюсь на Sky | WS'),
  offer: [preview('a', 2), preview('b')],
  request: [preview('c', 1, true)],
};

describe('captureTrades', () => {
  it('finds trades in a trade list response', () => {
    const found = captureTrades({ data: { cardTrades: { edges: [{ node: trade }] } } });
    expect(found.items).toEqual([
      {
        kind: 'trade',
        id: 't1',
        source: { id: 'u1', name: 'Phaivroh | WL' },
        destination: { id: 'u2', name: 'Молюсь на Sky | WS' },
        offer: [
          { slug: 'a', quantity: 2, shard: false },
          { slug: 'b', quantity: 1, shard: false },
        ],
        request: [{ slug: 'c', quantity: 1, shard: true }],
      },
    ]);
  });

  it('finds a trade nested in a notification and the viewer', () => {
    const found = captureTrades({
      data: { viewer: { user: { id: 'u2' } }, notificationFeeds: { edges: [{ node: { __typename: 'NotificationFeed', notifiable: trade } }] } },
    });
    expect(found.viewerId).toBe('u2');
    expect(found.items.map((item) => item.id)).toEqual(['t1']);
  });

  it('keeps the author of a fast trade', () => {
    const offer = { __typename: 'CardOffer', id: 'o1', user: user('u3', 'Smile'), viewerDidAuthor: false, offer: [preview('a')], request: [preview('b')] };
    expect(captureTrades({ data: { cardOffers: { edges: [{ node: offer }] } } }).items[0]).toMatchObject({ kind: 'offer', author: { name: 'Smile' } });
  });

  it('reads the server rendered payload and skips broken entries', () => {
    const payload = { graphql: { 1: { data: JSON.stringify({ cardTrades: { edges: [{ node: trade }] } }) }, 2: { data: '{broken' } } };
    expect(captureServerPayload(payload).flatMap((found) => found.items)).toHaveLength(1);
    expect(captureServerPayload(undefined)).toEqual([]);
  });
});

describe('trade store bridge', () => {
  it('asks for a replay and stores what comes back', () => {
    const store = createTradeStore();
    const onChange = vi.fn();
    const replay = vi.fn(() => document.dispatchEvent(new CustomEvent(TRADES_EVENT, { detail: JSON.stringify(captureTrades({ cardTrade: trade })) })));
    document.addEventListener(REPLAY_EVENT, replay, { once: true });
    listenForTrades(store, onChange);
    expect(replay).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(store.trades().map((item) => item.id)).toEqual(['t1']);
  });

  it('replaces a trade seen again under the same id', () => {
    const store = createTradeStore();
    store.add(captureTrades(trade));
    store.add(captureTrades({ ...trade, offer: [preview('z')] }));
    expect(store.trades()).toHaveLength(1);
    expect(store.trades()[0].offer[0].slug).toBe('z');
  });
});

describe('installCapture', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  const page = (fetchImpl) => {
    const win = new Window({ url: 'https://senkuro.me/notifications/all' });
    win.fetch = fetchImpl;
    const seen = [];
    win.document.addEventListener(TRADES_EVENT, (event) => seen.push(JSON.parse(event.detail)));
    installCapture(win);
    return { win, seen };
  };

  it('reads a GraphQL answer even when it comes without url or json type, as a service worker may give it', async () => {
    const { win, seen } = page(async () => new Response(JSON.stringify({ data: { notificationFeeds: { edges: [{ node: { notifiable: trade } }] } } })));
    const answer = await win.fetch('https://api.senkuro.me/graphql', { method: 'POST' });
    expect((await answer.json()).data.notificationFeeds.edges).toHaveLength(1);
    await settle();
    expect(seen.at(-1).items.map((item) => item.id)).toEqual(['t1']);
    await win.happyDOM.close();
  });

  it('takes the body when the site reads it as text, so a later abort of the request cannot cut it off', async () => {
    const { win, seen } = page(
      async () => new Response(JSON.stringify({ data: { cardTrade: trade } }), { headers: { 'content-type': 'application/graphql-response+json' } })
    );
    const answer = await win.fetch('https://api.senkuro.me/graphql', { method: 'POST' });
    const text = await answer.text();
    await settle();
    expect(JSON.parse(text).data.cardTrade.id).toBe('t1');
    expect(seen.at(-1).items.map((item) => item.id)).toEqual(['t1']);
    await win.happyDOM.close();
  });

  it('leaves other requests alone', async () => {
    const { win, seen } = page(async () => new Response(JSON.stringify({ cardTrade: trade })));
    await (await win.fetch('https://senkuro.me/assets/data.json')).json();
    await settle();
    expect(seen).toEqual([]);
    await win.happyDOM.close();
  });

  it('reads the server payload again on a later replay', async () => {
    const { win, seen } = page(async () => new Response('{}'));
    win.document.dispatchEvent(new win.CustomEvent(REPLAY_EVENT));
    win.__SENKURO__ = { graphql: { 1: { data: JSON.stringify({ cardTrade: trade }) } } };
    win.document.dispatchEvent(new win.CustomEvent(REPLAY_EVENT));
    expect(seen.map((found) => found.items.length)).toEqual([0, 1]);
    await win.happyDOM.close();
  });
});
