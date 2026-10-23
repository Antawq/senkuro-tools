import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import { findRouter, installCatalogSearch, redirectQueryToSearch, type CatalogLocation, type PageRouter } from '../utils/catalog/catalog-search';

const location = (name: string, query: Record<string, unknown>, fields?: string[]): CatalogLocation => ({
  name,
  params: fields === undefined ? {} : { fields },
  query,
});

describe('redirectQueryToSearch', () => {
  it('turns the query the site puts on a catalog address into the search filter the catalog reads', () => {
    expect(redirectQueryToSearch(location('browse-manga', { query: 'naruto' }, []))).toEqual({
      name: 'browse-manga',
      params: { fields: ['search', 'naruto'] },
      query: {},
    });
  });

  it('does the same for the anime catalog and when the site gives no fields at all', () => {
    expect(redirectQueryToSearch(location('browse-anime', { query: 'naruto' }))).toEqual({
      name: 'browse-anime',
      params: { fields: ['search', 'naruto'] },
      query: {},
    });
  });

  it('keeps a phrase of several words and drops the spaces around it', () => {
    expect(redirectQueryToSearch(location('browse-manga', { query: '  one piece ' }, []))?.params).toEqual({ fields: ['search', 'one piece'] });
  });

  it('leaves the other query parameters where they are', () => {
    expect(redirectQueryToSearch(location('browse-manga', { query: 'x', page: '2' }, []))?.query).toEqual({ page: '2' });
  });

  it('does nothing for an address that already has filters of its own', () => {
    expect(redirectQueryToSearch(location('browse-manga', { query: 'naruto' }, ['search', 'bleach']))).toBeUndefined();
    expect(redirectQueryToSearch(location('browse-manga', { query: 'naruto' }, ['genres', 'romance']))).toBeUndefined();
  });

  it('does nothing without a usable query', () => {
    for (const query of [{}, { query: '' }, { query: '   ' }, { query: ['a', 'b'] }, { query: null }, { query: 5 }]) {
      expect(redirectQueryToSearch(location('browse-manga', query, []))).toBeUndefined();
    }
  });

  it('does nothing for a page that is not a catalog this fix is known to work on', () => {
    for (const name of ['browse-cards', 'browse-decks', 'browse-teams', 'browse-ranobe', 'manga-slug', undefined]) {
      expect(redirectQueryToSearch({ name, params: { fields: [] }, query: { query: 'naruto' } })).toBeUndefined();
    }
  });
});

describe('findRouter', () => {
  const pageWith = (app: unknown) => {
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__?: unknown }).__vue_app__ = app;
    return pageWindow.document as unknown as Document;
  };

  it('finds the router the site installs on its app', () => {
    const router: PageRouter = { beforeEach: () => () => undefined };
    expect(findRouter(pageWith({ config: { globalProperties: { $router: router } } }))).toBe(router);
  });

  it('returns null when the app, the property or the method is missing', () => {
    for (const app of [
      undefined,
      {},
      { config: {} },
      { config: { globalProperties: {} } },
      { config: { globalProperties: { $router: {} } } },
      { config: { globalProperties: { $router: 'x' } } },
    ]) {
      expect(findRouter(pageWith(app))).toBeNull();
    }
  });
});

describe('installCatalogSearch', () => {
  const rig = () => {
    const guards: Parameters<PageRouter['beforeEach']>[0][] = [];
    const router: PageRouter = { beforeEach: vi.fn((guard: Parameters<PageRouter['beforeEach']>[0]) => void guards.push(guard)) };
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const client = { executeQuery: () => null, executeMutation: () => null, query: () => ({ toPromise: () => Promise.resolve({}) }) };
    pageWindow.fetch = (() => Promise.resolve(new Response('{}'))) as unknown as typeof pageWindow.fetch;
    const mount = (withRouter = true) => {
      (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {
        _context: { provides: { $urql: client } },
        config: { globalProperties: withRouter ? { $router: router } : {} },
      };
    };
    const respond = async () => {
      await pageWindow.fetch('https://api.senkuro.me/graphql');
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { guards, router, client, mount, respond, typed: pageWindow as unknown as Parameters<typeof installCatalogSearch>[0] };
  };

  it('puts its guard on the site router once the app is up, and not before', async () => {
    const { typed, router, mount, respond } = rig();
    installCatalogSearch(typed);
    await respond();
    expect(router.beforeEach).not.toHaveBeenCalled();
    mount();
    await respond();
    expect(router.beforeEach).toHaveBeenCalledTimes(1);
  });

  it('puts the fallback of the catalog on the site client at the same time', async () => {
    const { typed, client, mount, respond } = rig();
    const before = client.executeQuery;
    installCatalogSearch(typed);
    mount();
    await respond();
    expect(client.executeQuery).not.toBe(before);
  });

  it('gives the router the guard that redirects a catalog query', async () => {
    const { typed, guards, mount, respond } = rig();
    installCatalogSearch(typed);
    mount();
    await respond();
    expect(guards[0]?.(location('browse-manga', { query: 'naruto' }, []))).toEqual(redirectQueryToSearch(location('browse-manga', { query: 'naruto' }, [])));
    expect(guards[0]?.(location('manga-slug', {}, []))).toBeUndefined();
  });

  it('installs once however often it is asked, for a page that was already claimed', async () => {
    const { typed, router, mount, respond } = rig();
    installCatalogSearch(typed);
    installCatalogSearch(typed);
    mount();
    await respond();
    await respond();
    expect(router.beforeEach).toHaveBeenCalledTimes(1);
  });

  it('does nothing and does not fail when the app has no router', async () => {
    const { typed, mount, respond } = rig();
    installCatalogSearch(typed);
    mount(false);
    await expect(respond()).resolves.toBeUndefined();
  });
});
