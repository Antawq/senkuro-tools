import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';

import { findClient, operationName, whenClient, type QueryClient, type QueryRequest } from '../utils/shared/urql-client';

const request = (name: string): QueryRequest => ({
  key: 1,
  variables: {},
  query: {
    definitions: [
      { kind: 'FragmentDefinition', name: { value: 'Part' } },
      { kind: 'OperationDefinition', name: { value: name } },
    ],
  },
});

const clientWith = () => {
  const client: QueryClient = {
    executeQuery: () => null,
    executeMutation: () => null,
    query: () => ({ toPromise: () => Promise.resolve({}) }),
  };
  return { client };
};

describe('operationName', () => {
  it('reads the operation name past other definitions', () => {
    expect(operationName(request('forgeCards'))).toBe('forgeCards');
    expect(operationName({})).toBeUndefined();
    expect(operationName({ query: { definitions: [{ kind: 'FragmentDefinition', name: { value: 'Part' } }] } })).toBeUndefined();
  });
});

describe('findClient', () => {
  const pageWith = (provided: unknown) => {
    const pageWindow = new Window({ url: 'https://senkuro.me/forge/split' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const app = pageWindow.document.querySelector('#app') as unknown as { __vue_app__?: unknown };
    if (provided !== undefined) app.__vue_app__ = { _context: { provides: { $urql: provided } } };
    return pageWindow;
  };

  it('finds the client the site provides inside a ref, or directly', async () => {
    const { client } = clientWith();
    for (const provided of [{ value: client }, client]) {
      const pageWindow = pageWith(provided);
      expect(findClient(pageWindow.document as unknown as Document)).toBe(client);
      await pageWindow.happyDOM.close();
    }
  });

  it('returns null when the app, the provide or a needed method is missing', async () => {
    const partial = { executeQuery: () => null };
    for (const provided of [undefined, {}, { value: {} }, { value: null }, 'text', partial, { value: partial }]) {
      const pageWindow = pageWith(provided);
      expect(findClient(pageWindow.document as unknown as Document)).toBeNull();
      await pageWindow.happyDOM.close();
    }
    const bare = new Window({ url: 'https://senkuro.me/' });
    expect(findClient(bare.document as unknown as Document)).toBeNull();
    await bare.happyDOM.close();
  });
});

describe('whenClient', () => {
  const rig = (mounted: boolean) => {
    const { client } = clientWith();
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const answer = new Response('{}');
    pageWindow.fetch = (() => Promise.resolve(answer)) as unknown as typeof pageWindow.fetch;
    const mount = () => {
      (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: { value: client } } } };
    };
    if (mounted) mount();
    const typed = pageWindow as unknown as Parameters<typeof whenClient>[0];
    const respond = async () => {
      await pageWindow.fetch('https://api.senkuro.me/graphql');
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { pageWindow, typed, client, answer, mount, respond };
  };

  it('waits for a response after the app has mounted before it calls back, and only once', async () => {
    const { typed, client, mount, respond } = rig(false);
    const seen: QueryClient[] = [];
    whenClient(typed, (found) => seen.push(found));
    await respond();
    expect(seen).toEqual([]);
    mount();
    await respond();
    await respond();
    expect(seen).toEqual([client]);
  });

  it('calls back at once for a caller that comes after the client was found', async () => {
    const { typed, client, respond } = rig(true);
    whenClient(typed, () => undefined);
    await respond();
    const late: QueryClient[] = [];
    whenClient(typed, (found) => late.push(found));
    expect(late).toEqual([client]);
  });

  it('serves every caller with one wrapper over the page fetch', async () => {
    const { pageWindow, typed, respond } = rig(true);
    const seen: string[] = [];
    whenClient(typed, () => seen.push('first'));
    const wrapped = Reflect.get(pageWindow, 'fetch') as unknown;
    whenClient(typed, () => seen.push('second'));
    expect(Reflect.get(pageWindow, 'fetch')).toBe(wrapped);
    await respond();
    expect(seen).toEqual(['first', 'second']);
  });

  it('hands the page its response untouched and passes a failure through', async () => {
    const { pageWindow, typed, answer } = rig(true);
    whenClient(typed, () => undefined);
    expect(await pageWindow.fetch('https://api.senkuro.me/graphql')).toBe(answer);
    const failing = rig(true);
    failing.pageWindow.fetch = () => Promise.reject(new Error('offline'));
    whenClient(failing.typed, () => undefined);
    await expect(failing.pageWindow.fetch('https://api.senkuro.me/graphql')).rejects.toThrow('offline');
  });
});
