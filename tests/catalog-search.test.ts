import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import type { Client } from '@urql/core';

import { catalogFallbackExchange } from '../utils/catalog/catalog-fallback';
import { findRouter, installCatalogRouting, redirectQueryToSearch, type CatalogLocation, type PageRouter } from '../utils/catalog/catalog-search';
import { installClientSwap } from '../utils/shared/client-swap';
import { answersFor, answersOnce, catalogRequest, createCatalogSiteClient, emptyCatalog, searchAnswer } from './helpers/catalog-requests';

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

  it('starts a fresh search when the filters only came over from the address it leaves, as the router carries them on a push to the same catalog', () => {
    const leaving = location('browse-manga', {}, ['search', 'наруто']);
    expect(redirectQueryToSearch(location('browse-manga', { query: 'берсерк' }, ['search', 'наруто']), leaving)).toEqual({
      name: 'browse-manga',
      params: { fields: ['search', 'берсерк'] },
      query: {},
    });
    const filtered = location('browse-manga', {}, ['genres', 'romance']);
    expect(redirectQueryToSearch(location('browse-manga', { query: 'берсерк' }, ['genres', 'romance']), filtered)?.params).toEqual({
      fields: ['search', 'берсерк'],
    });
  });

  it('keeps filters an address brings itself, coming from another page or another catalog', () => {
    expect(redirectQueryToSearch(location('browse-manga', { query: 'берсерк' }, ['search', 'наруто']), location('main', {}))).toBeUndefined();
    expect(
      redirectQueryToSearch(location('browse-manga', { query: 'берсерк' }, ['search', 'наруто']), location('browse-anime', {}, ['search', 'наруто']))
    ).toBeUndefined();
    expect(
      redirectQueryToSearch(location('browse-manga', { query: 'берсерк' }, ['search', 'наруто']), location('browse-manga', {}, ['search', 'блич']))
    ).toBeUndefined();
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
    const router: PageRouter = { beforeEach: () => () => undefined, afterEach: () => () => undefined };
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

describe('installCatalogRouting on a catalog search page', () => {
  const pageWithRouter = () => {
    const guards: Parameters<PageRouter['beforeEach']>[0][] = [];
    const router: PageRouter = {
      beforeEach: (guard) => void guards.push(guard),
      afterEach: () => undefined,
      resolve: (target) => ({ href: `/browse/manga/${target.params.fields.join('/')}` }),
    };
    const pageWindow = new Window({ url: 'https://senkuro.me/browse/manga/search/naruto' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { config: { globalProperties: { $router: router } } };
    const assign = vi.spyOn(pageWindow.location, 'assign').mockImplementation(() => undefined);
    installCatalogRouting(pageWindow.document as unknown as Document);
    return { guard: guards[0]!, assign };
  };

  it('loads the new search as a page when the query leaves a search of the same catalog, whose list the site keeps', () => {
    const { guard, assign } = pageWithRouter();
    const leaving = location('browse-manga', {}, ['search', 'наруто']);
    expect(guard(location('browse-manga', { query: 'берсерк' }, ['search', 'наруто']), leaving)).toBe(false);
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/browse/manga/search/берсерк');
  });

  it('keeps the push inside the page when the query comes from a catalog without a search, which the site refreshes', () => {
    const { guard, assign } = pageWithRouter();
    expect(guard(location('browse-manga', { query: 'берсерк' }, []), location('browse-manga', {}, []))).toEqual({
      name: 'browse-manga',
      params: { fields: ['search', 'берсерк'] },
      query: {},
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the push inside the page when the query repeats the search the page already shows', () => {
    const { guard, assign } = pageWithRouter();
    const leaving = location('browse-manga', {}, ['search', 'наруто']);
    expect(guard(location('browse-manga', { query: 'наруто' }, ['search', 'наруто']), leaving)).toEqual({
      name: 'browse-manga',
      params: { fields: ['search', 'наруто'] },
      query: {},
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('leaves a navigation without a query alone, the site filters and links included', () => {
    const { guard, assign } = pageWithRouter();
    const leaving = location('browse-manga', {}, ['search', 'наруто']);
    expect(guard(location('browse-manga', {}, []), leaving)).toBeUndefined();
    expect(guard(location('browse-manga', {}, ['search', 'наруто', 'labels', 'male_protagonist']), leaving)).toBeUndefined();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('installCatalogRouting with the client swap', () => {
  const rig = () => {
    const guards: Parameters<PageRouter['beforeEach']>[0][] = [];
    const navigated: (() => void)[] = [];
    const router: PageRouter = {
      beforeEach: vi.fn((guard: Parameters<PageRouter['beforeEach']>[0]) => void guards.push(guard)),
      afterEach: vi.fn((hook: () => void) => void navigated.push(hook)),
    };
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const { siteClient } = createCatalogSiteClient({
      catalogAnswers: () => answersOnce([emptyCatalog]),
      answerOwn: (call) => answersOnce([call.document.includes('catalogRowFacts') ? { data: {} } : searchAnswer('naruto')]),
    });
    const clientRef = { __v_isRef: true, value: siteClient as unknown };
    const typed = pageWindow as unknown as Parameters<typeof installClientSwap>[0];
    const install = () => installClientSwap(typed, () => ({ exchangesFor: () => [catalogFallbackExchange(installCatalogRouting(typed.document))] }));
    const mount = (withRouter = true) => {
      (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {
        _context: { provides: { $urql: clientRef } },
        config: { globalProperties: withRouter ? { $router: router } : {} },
      };
    };
    const answers = () => answersFor(clientRef.value as Client, catalogRequest('fetchMangas'));
    return { guards, navigated, router, siteClient, clientRef, install, mount, answers };
  };

  it('puts its guard on the site router once the app is up, and not before', () => {
    const { router, install, mount } = rig();
    install();
    expect(router.beforeEach).not.toHaveBeenCalled();
    mount();
    expect(router.beforeEach).toHaveBeenCalledTimes(1);
  });

  it('puts the fallback of the catalog in front of the site client at the same time', async () => {
    const { siteClient, clientRef, install, mount, answers } = rig();
    install();
    mount();
    expect(clientRef.value).not.toBe(siteClient);
    expect((await answers()).at(-1)?.data).toMatchObject({ mangas: { edges: [{ node: { slug: 'naruto' } }] } });
  });

  it('gives the router the guard that redirects a catalog query', () => {
    const { guards, install, mount } = rig();
    install();
    mount();
    const leaving = location('main', {});
    expect(guards[0]?.(location('browse-manga', { query: 'naruto' }, []), leaving)).toEqual(
      redirectQueryToSearch(location('browse-manga', { query: 'naruto' }, []), leaving)
    );
    expect(guards[0]?.(location('manga-slug', {}, []), leaving)).toBeUndefined();
  });

  it('hands the page the empty answer first while the router has not navigated yet', async () => {
    const { install, mount, answers } = rig();
    install();
    mount();
    expect(await answers()).toHaveLength(2);
    expect(await answers()).toHaveLength(2);
  });

  it('answers with the rows at once once the router has navigated', async () => {
    const { navigated, install, mount, answers } = rig();
    install();
    mount();
    navigated.forEach((hook) => hook());
    expect(await answers()).toHaveLength(1);
  });

  it('answers with the rows at once when the page has no router to tell', async () => {
    const { install, mount, answers } = rig();
    install();
    mount(false);
    expect(await answers()).toHaveLength(1);
  });

  it('installs once however often it is asked, for a page that was already claimed', () => {
    const { router, install, mount } = rig();
    install();
    install();
    mount();
    expect(router.beforeEach).toHaveBeenCalledTimes(1);
  });

  it('does nothing and does not fail when the app has no router', () => {
    const { install, mount, clientRef, siteClient } = rig();
    install();
    expect(() => mount(false)).not.toThrow();
    expect(clientRef.value).not.toBe(siteClient);
  });
});
