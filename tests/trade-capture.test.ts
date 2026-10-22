import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import {
  REPLAY_EVENT,
  TRADES_EVENT,
  captureServerPayload,
  captureTrades,
  createTradeStore,
  installCapture,
  listenForTrades,
  type Capture,
  type Trade,
} from '../utils/trade-capture';

const preview = (slug: string, quantity = 1, shard = false) => ({
  __typename: 'CardPreview',
  modifier: 0,
  quantity,
  shard,
  card: { __typename: 'Card', id: slug, slug, rank: 'F' },
});
const user = (id: string, name: string) => ({ __typename: 'User', id, slug: id, name });

const trade = {
  __typename: 'CardTrade',
  id: 't1',
  status: 'PENDING',
  createdAt: '2026-10-17T18:31:05.923657',
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
        createdAt: '2026-10-17T18:31:05.923657',
        status: 'PENDING',
        offer: [
          { slug: 'a', quantity: 2, shard: false },
          { slug: 'b', quantity: 1, shard: false },
        ],
        request: [{ slug: 'c', quantity: 1, shard: true }],
      },
    ]);
  });

  it('leaves the time of a trade empty when the answer has none', () => {
    const found = captureTrades({ data: { cardTrades: { edges: [{ node: { ...trade, createdAt: undefined } }] } } });
    expect((found.items[0] as Trade).createdAt).toBeNull();
  });

  it('takes the status a notification names under its own alias', () => {
    const notifiable = { ...trade, status: undefined, tradeStatus: 'REJECTED' };
    const found = captureTrades({ data: { notificationFeeds: { edges: [{ node: { notifiable } }] } } });
    expect((found.items[0] as Trade).status).toBe('REJECTED');
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

  describe('in an answer that carries no typenames', () => {
    const bare = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(bare)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== '__typename')
                .map(([key, inner]): [string, unknown] => [key, bare(inner)])
            )
          : value;
    const offer = { __typename: 'CardOffer', id: 'o1', user: user('u3', 'Smile'), viewerDidAuthor: true, offer: [preview('a')], request: [preview('b', 2)] };

    it('still tells a trade by its two sides', () => {
      const found = captureTrades(bare({ data: { cardTrades: { edges: [{ node: trade }] } } }));
      expect(found.items.map(({ kind, id }) => [kind, id])).toEqual([['trade', 't1']]);
      expect((found.items[0] as Trade).source.name).toBe('Phaivroh | WL');
    });

    it('still tells an offer by its author and the viewer flag', () => {
      const found = captureTrades(bare({ data: { cardOffers: { edges: [{ node: offer }] } } }));
      expect(found.items).toEqual([
        {
          kind: 'offer',
          id: 'o1',
          author: { id: 'u3', name: 'Smile' },
          viewerDidAuthor: true,
          offer: [{ slug: 'a', quantity: 1, shard: false }],
          request: [{ slug: 'b', quantity: 2, shard: false }],
        },
      ]);
    });

    it('takes the slug of a preview that carries it directly', () => {
      const flat = {
        id: 'o2',
        user: user('u3', 'Smile'),
        viewerDidAuthor: false,
        offer: [{ slug: 'x', quantity: 1, shard: false }],
        request: [{ slug: 'y', quantity: 3, shard: true }],
      };
      expect(captureTrades({ data: { cardOffers: { edges: [{ node: flat }] } } }).items[0]).toMatchObject({
        offer: [{ slug: 'x', quantity: 1, shard: false }],
        request: [{ slug: 'y', quantity: 3, shard: true }],
      });
    });

    it('does not mistake a card transaction for an offer, nor a node of another named type', () => {
      const transaction = { id: 'x1', user: user('u3', 'Smile'), type: 'TRADE', offer: [preview('a')], request: [preview('b')] };
      const named = {
        __typename: 'UserCardTransaction',
        id: 'x2',
        user: user('u3', 'Smile'),
        viewerDidAuthor: true,
        offer: [preview('a')],
        request: [preview('b')],
      };
      expect(captureTrades(bare({ data: { transactions: [transaction] } })).items).toEqual([]);
      expect(captureTrades({ data: { transactions: [named] } }).items).toEqual([]);
    });
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
    expect(store.trades()[0]?.offer[0]?.slug).toBe('z');
  });
});

describe('installCapture', () => {
  type Reply = Awaited<ReturnType<Window['fetch']>>;
  type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
  type Reader = (response: Reply) => Promise<unknown>;
  type Init = NonNullable<Parameters<Window['fetch']>[1]>;

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  const capturing = (win: Window) => installCapture(win as unknown as Parameters<typeof installCapture>[0]);

  const ids = (found: Capture | undefined) => found?.items.map((item) => item.id);

  const page = (fetchImpl: Fetch) => {
    const win = new Window({ url: 'https://senkuro.me/notifications/all' });
    win.fetch = fetchImpl as unknown as typeof win.fetch;
    const seen: Capture[] = [];
    win.document.addEventListener(TRADES_EVENT, (event) => seen.push(JSON.parse((event as unknown as CustomEvent<string>).detail) as Capture));
    capturing(win);
    return { win, seen };
  };

  it('reads a GraphQL answer even when it comes without url or json type, as a service worker may give it', async () => {
    const { win, seen } = page(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { notificationFeeds: { edges: [{ node: { notifiable: trade } }] } } })))
    );
    const answer = await win.fetch('https://api.senkuro.me/graphql', { method: 'POST' });
    expect(((await answer.json()) as unknown as { data: { notificationFeeds: { edges: unknown[] } } }).data.notificationFeeds.edges).toHaveLength(1);
    await settle();
    expect(ids(seen.at(-1))).toEqual(['t1']);
    await win.happyDOM.close();
  });

  it('takes the body when the site reads it as text, so a later abort of the request cannot cut it off', async () => {
    const { win, seen } = page(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { cardTrade: trade } }), { headers: { 'content-type': 'application/graphql-response+json' } }))
    );
    const answer = await win.fetch('https://api.senkuro.me/graphql', { method: 'POST' });
    const text = await answer.text();
    await settle();
    expect((JSON.parse(text) as { data: { cardTrade: { id: string } } }).data.cardTrade.id).toBe('t1');
    expect(ids(seen.at(-1))).toEqual(['t1']);
    await win.happyDOM.close();
  });

  const answer = () => new Response(JSON.stringify({ data: { cardTrade: trade } }), { headers: { 'content-type': 'application/json' } });

  const abortableCopy = (response: Response, signal: AbortSignal) => {
    const clone = response.clone.bind(response);
    response.clone = () => {
      const copy = clone();
      const read = copy.text.bind(copy);
      copy.text = () =>
        new Promise<string>((resolve, reject) =>
          setTimeout(() => {
            if (signal.aborted) reject(new DOMException('The operation was aborted.', 'AbortError'));
            else read().then(resolve, reject);
          })
        );
      return copy;
    };
    return response;
  };

  it('keeps the answer when the site aborts the request right after reading it, as urql does', async () => {
    const { win, seen } = page((_input, init) => Promise.resolve(abortableCopy(answer(), init?.signal as AbortSignal)));
    const controller = new AbortController();
    const given = await win.fetch('https://api.senkuro.me/graphql', { method: 'POST', signal: controller.signal as unknown as Init['signal'] });
    expect((JSON.parse(await given.text()) as { data: { cardTrade: { id: string } } }).data.cardTrade.id).toBe('t1');
    controller.abort();
    await settle();
    expect(ids(seen.at(-1))).toEqual(['t1']);
    await win.happyDOM.close();
  });

  const readers: [string, Reader][] = [
    ['as bytes', (response) => response.arrayBuffer()],
    ['through a clone', (response) => response.clone().json()],
    [
      'through the body stream',
      async (response) => {
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        while (!(await reader.read()).done);
      },
    ],
    ['never', () => Promise.resolve(undefined)],
  ];

  it.each(readers)('takes the answer whichever way the site reads it: %s', async (_name, read) => {
    const { win, seen } = page(() => Promise.resolve(answer()));
    await read(await win.fetch('https://api.senkuro.me/graphql', { method: 'POST' }));
    await settle();
    expect(ids(seen.at(-1))).toEqual(['t1']);
    await win.happyDOM.close();
  });

  it('does not touch the answer the site is given', async () => {
    const { win } = page(() => Promise.resolve(answer()));
    const given = await win.fetch('https://api.senkuro.me/graphql', { method: 'POST' });
    expect(((await given.json()) as unknown as { data: { cardTrade: { id: string } } }).data.cardTrade.id).toBe('t1');
    await win.happyDOM.close();
  });

  it('stays silent unless the debug switch is set, then tells what it sees', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const quiet = page(() => Promise.resolve(answer()));
    await quiet.win.fetch('https://api.senkuro.me/graphql', { method: 'POST' });
    await settle();
    expect(log).not.toHaveBeenCalled();
    await quiet.win.happyDOM.close();

    const loud = new Window({ url: 'https://senkuro.me/notifications/all' });
    loud.localStorage.setItem('senkutoolsDebug', '1');
    loud.fetch = (() => Promise.resolve(answer())) as unknown as typeof loud.fetch;
    capturing(loud);
    await loud.fetch('https://api.senkuro.me/graphql', { method: 'POST' });
    await settle();
    const lines = log.mock.calls.map(([, ...rest]) => JSON.stringify(rest));
    expect(lines.some((line) => line.includes('capture installed'))).toBe(true);
    expect(lines.some((line) => line.includes('"streamed":false'))).toBe(true);
    expect(lines.some((line) => line.includes('"items":1'))).toBe(true);
    await loud.happyDOM.close();
    log.mockRestore();
  });

  it('leaves other requests alone', async () => {
    const { win, seen } = page(() => Promise.resolve(new Response(JSON.stringify({ cardTrade: trade }))));
    await (await win.fetch('https://senkuro.me/assets/data.json')).json();
    await settle();
    expect(seen).toEqual([]);
    await win.happyDOM.close();
  });

  it('reads the server payload again on a later replay', async () => {
    const { win, seen } = page(() => Promise.resolve(new Response('{}')));
    win.document.dispatchEvent(new win.CustomEvent(REPLAY_EVENT));
    (win as unknown as { __SENKURO__: unknown }).__SENKURO__ = { graphql: { 1: { data: JSON.stringify({ cardTrade: trade }) } } };
    win.document.dispatchEvent(new win.CustomEvent(REPLAY_EVENT));
    expect(seen.map((found) => found.items.length)).toEqual([0, 1]);
    await win.happyDOM.close();
  });
});
