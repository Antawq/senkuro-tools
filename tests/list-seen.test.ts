import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';

import { createCursorLedger } from '../utils/inventory/list-cursors';
import { LIST_OPERATION, type Variables } from '../utils/inventory/list-families';
import { learnFromFetch } from '../utils/inventory/list-seen';

const GRAPHQL = 'https://api.senkuro.me/graphql';

const cards = (after?: string | null): Variables => ({ userId: 'USER:1', modifier: { include: [0] }, ...(after === undefined ? {} : { after }) });
const shards = (after?: string | null): Variables => ({ userId: 'USER:1', modifier: { include: [1] }, ...(after === undefined ? {} : { after }) });

const answerOf = (endCursor: unknown) => ({ data: { userCards: { pageInfo: { endCursor, hasNextPage: true }, edges: [] } } });

const body = (variables: Variables, operationName = LIST_OPERATION) => JSON.stringify({ operationName, variables });

type Reply = () => Response | Promise<Response>;

const rig = (reply: Reply = () => new Response(JSON.stringify(answerOf('c1')))) => {
  const win = new Window({ url: 'https://senkuro.me/users/x/cards' });
  const seen: { url: string; init?: RequestInit }[] = [];
  win.fetch = ((url: string, init?: RequestInit) => {
    seen.push({ url, init });
    try {
      return Promise.resolve(reply());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }) as unknown as typeof win.fetch;
  const ledger = createCursorLedger();
  learnFromFetch(win as unknown as Parameters<typeof learnFromFetch>[0], ledger);
  const call = (url: string, init?: RequestInit) => (win.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>)(url, init);
  return { win, seen, ledger, call };
};

describe('learnFromFetch', () => {
  it('learns the end cursor of a list answer with the list that asked, before the site client is even found', async () => {
    const { call, ledger } = rig();
    await call(GRAPHQL, { method: 'POST', body: body(cards()) });
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    expect(ledger.isForeign(cards('c1'))).toBe(false);
  });

  it('learns the cursor a list asked with too, which the site handed out before this script was there', async () => {
    const { call, ledger } = rig(() => new Response(JSON.stringify(answerOf('c2'))));
    await call(GRAPHQL, { method: 'POST', body: body(cards('c1')) });
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    expect(ledger.isForeign(shards('c2'))).toBe(true);
    expect(ledger.isForeign(cards('c1'))).toBe(false);
  });

  it('hands the site the answer whole, and passes the call on untouched', async () => {
    const { call, seen } = rig();
    const init = { method: 'POST', body: body(cards()) };
    const response = await call(GRAPHQL, init);
    expect(await response.json()).toEqual(answerOf('c1'));
    expect(seen).toEqual([{ url: GRAPHQL, init }]);
  });

  it('reads the request body and the answer only for list queries on the graphql address', async () => {
    const { call, ledger, win } = rig();
    await call(GRAPHQL, { method: 'POST', body: body(cards(), 'fetchViewer') });
    await call('https://senkuro.me/other', { method: 'POST', body: body(cards()) });
    await call(new URL(GRAPHQL).href.replace('/graphql', '/graphql/extra'), { method: 'POST', body: body(cards()) });
    await call(GRAPHQL, { method: 'GET' });
    await call(GRAPHQL, { method: 'POST', body: new Uint8Array([1, 2, 3]) as unknown as BodyInit });
    await call(GRAPHQL, { method: 'POST', body: { toString: () => body(cards()) } as unknown as BodyInit });
    await call(GRAPHQL, { method: 'POST', body: 'not json' });
    await call(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: LIST_OPERATION }) });
    await call(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: LIST_OPERATION, variables: 'x' }) });
    expect(ledger.isForeign(shards('c1'))).toBe(false);
    await win.happyDOM.close();
  });

  it('takes the address from a request object or a URL too', async () => {
    const { call, ledger, win } = rig();
    await call(new URL(GRAPHQL) as unknown as string, { method: 'POST', body: body(cards()) });
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    const second = rig(() => new Response(JSON.stringify(answerOf('c7'))));
    await second.call({ url: GRAPHQL } as unknown as string, { method: 'POST', body: body(cards()) });
    expect(second.ledger.isForeign(shards('c7'))).toBe(true);
    await win.happyDOM.close();
  });

  it('learns nothing from an answer that is not a list, is not json, or has no cursor, and still returns it', async () => {
    for (const reply of [
      () => new Response('<html>'),
      () => new Response(JSON.stringify({ data: { userCards: null } })),
      () => new Response(JSON.stringify(answerOf(null))),
      () => new Response(JSON.stringify(answerOf(''))),
    ]) {
      const { call, ledger } = rig(reply);
      const response = await call(GRAPHQL, { method: 'POST', body: body(cards()) });
      expect(response).toBeInstanceOf(Response);
      expect(ledger.isForeign(shards('c1'))).toBe(false);
      expect(ledger.isForeign(shards(''))).toBe(false);
    }
  });

  it('does not read an answer that is streamed', async () => {
    let read = false;
    const reply: Reply = () => {
      const response = new Response('x', { headers: { 'content-type': 'multipart/mixed; boundary=-' } });
      response.clone = () => {
        read = true;
        return new Response(JSON.stringify(answerOf('c1')));
      };
      return response;
    };
    const { call, ledger } = rig(reply);
    await call(GRAPHQL, { method: 'POST', body: body(cards()) });
    expect(read).toBe(false);
    expect(ledger.isForeign(shards('c1'))).toBe(false);
  });

  it('has read the copy before the site gets the answer, so the site closing the request cannot cut the copy short', async () => {
    let read = false;
    const reply: Reply = () => {
      const response = new Response('x');
      response.clone = () =>
        ({
          text: () =>
            new Promise<string>((resolve) =>
              setTimeout(() => {
                read = true;
                resolve(JSON.stringify(answerOf('c1')));
              }, 10)
            ),
        }) as unknown as Response;
      return response;
    };
    const { call } = rig(reply);
    await call(GRAPHQL, { method: 'POST', body: body(cards()) });
    expect(read).toBe(true);
  });

  it('keeps the site working when the copy cannot be read', async () => {
    const reply: Reply = () => {
      const response = new Response('x');
      response.clone = () => {
        throw new Error('aborted');
      };
      return response;
    };
    const { call } = rig(reply);
    const response = await call(GRAPHQL, { method: 'POST', body: body(cards()) });
    expect(await response.text()).toBe('x');
  });

  it('passes a failed call on as it failed', async () => {
    const { win, call } = rig(() => {
      throw new Error('offline');
    });
    await expect(call(GRAPHQL, { method: 'POST', body: body(cards()) })).rejects.toThrow('offline');
    await win.happyDOM.close();
  });
});
