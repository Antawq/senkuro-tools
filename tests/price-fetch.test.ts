import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';

import type { Variables } from '../utils/inventory/list-families';
import { answerPrivateRequests } from '../utils/inventory/price-fetch';
import { privateFieldOf } from '../utils/inventory/price-private';
import type { PageAnswer } from '../utils/inventory/price-view';
import type { PageWindow } from '../utils/shared/page-window';

const GRAPHQL = 'https://api.senkuro.me/graphql';

const answerPage: PageAnswer = {
  data: { userCards: { __typename: 'UserCardConnection', edges: [], pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null } } },
};

const privateVariables = { userId: 'USER:1', orderField: privateFieldOf(1), orderDirection: 'DESC', after: null };

const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

const rig = () => {
  const win = new Window({ url: 'https://senkuro.me/users/sena/cards' });
  const native: { url: string; body: unknown }[] = [];
  win.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    native.push({ url: urlOf(url), body: init?.body });
    return Promise.resolve(new Response('{"native":true}'));
  }) as unknown as typeof win.fetch;
  const asked: Variables[] = [];
  answerPrivateRequests(win as unknown as PageWindow, {
    answer: (variables) => {
      asked.push(variables);
      return answerPage;
    },
  });
  return { win, native, asked };
};

describe('answerPrivateRequests', () => {
  it('lets every request that is not for the api go on untouched', async () => {
    const { win, native } = rig();
    expect(await (await win.fetch('https://senkuro.me/sw.js')).json()).toEqual({ native: true });
    expect(native.map((call) => call.url)).toEqual(['https://senkuro.me/sw.js']);
    await win.happyDOM.close();
  });

  it('lets the requests of the api go on', async () => {
    const { win, native, asked } = rig();
    await win.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: 'fetchViewer', variables: {} }) });
    await win.fetch(`${GRAPHQL}?operationName=x&variables=%7B%7D`);
    expect(native).toHaveLength(2);
    expect(asked).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('answers a request that names the private order itself, from the page, and never asks the network', async () => {
    const { win, native, asked } = rig();
    const response = await win.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: 'fetchUserCards', variables: privateVariables }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual(answerPage);
    expect(asked).toEqual([privateVariables]);
    expect(native).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('reads the variables of a request that came by the address, as the site sends the ones it can cache', async () => {
    const { win, native, asked } = rig();
    const url = `${GRAPHQL}?operationName=fetchUserCards&variables=${encodeURIComponent(JSON.stringify(privateVariables))}&extensions=%7B%7D`;
    expect(await (await win.fetch(url)).json()).toEqual(answerPage);
    expect(asked).toEqual([privateVariables]);
    expect(native).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('answers a request it cannot read the variables of as well, and still does not let it go on', async () => {
    const { win, native, asked } = rig();
    await win.fetch(GRAPHQL, { method: 'POST', body: `not json ${privateFieldOf(1)}` });
    await win.fetch(`${GRAPHQL}?variables=nonsense&x=${privateFieldOf(2)}`);
    expect(asked).toEqual([{}, {}]);
    expect(native).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('does not answer the name when it is not sent to the api', async () => {
    const { win, native, asked } = rig();
    await win.fetch('https://senkuro.me/search', { method: 'POST', body: privateFieldOf(1) });
    expect(native).toHaveLength(1);
    expect(asked).toHaveLength(0);
    await win.happyDOM.close();
  });
});
