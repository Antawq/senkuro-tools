import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import type { Client } from '@urql/core';

import { catalogFallbackExchange } from '../utils/catalog/catalog-fallback';
import {
  findRouter,
  installCatalogRouting,
  redirectQueryToSearch,
  type CatalogLocation,
  type CatalogReplay,
  type CatalogRouting,
  type PageRouter,
} from '../utils/catalog/catalog-search';
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
    const router: PageRouter = { beforeEach: () => () => undefined, afterEach: () => () => undefined, replace: () => Promise.resolve() };
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
      { config: { globalProperties: { $router: { beforeEach: () => undefined, afterEach: () => undefined } } } },
    ]) {
      expect(findRouter(pageWith(app))).toBeNull();
    }
  });
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const installOn = (router: PageRouter): CatalogRouting => {
  const pageWindow = new Window({ url: 'https://senkuro.me/browse/manga' });
  pageWindow.document.body.innerHTML = '<div id="app"></div>';
  (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { config: { globalProperties: { $router: router } } };
  return installCatalogRouting(pageWindow.document as unknown as Document);
};

describe('installCatalogRouting after a change of a catalog list', () => {
  const routerWith = (replace: PageRouter['replace'] = vi.fn(() => Promise.resolve())) => {
    const hooks: Parameters<PageRouter['afterEach']>[0][] = [];
    const routing = installOn({ beforeEach: () => undefined, afterEach: (hook) => void hooks.push(hook), replace });
    const finish = (destination: CatalogLocation, origin: CatalogLocation, failure?: unknown) => hooks.forEach((hook) => hook(destination, origin, failure));
    const navigate = async (destination: CatalogLocation, origin: CatalogLocation, failure?: unknown) => {
      finish(destination, origin, failure);
      await settle();
    };
    return { finish, navigate, replace, routing };
  };
  const naruto = location('browse-manga', {}, ['search', 'naruto']);
  const berserk = location('browse-manga', {}, ['search', 'berserk']);

  it('replays a list change the catalog answered with no list request as a forced replace, in every catalog of lists', async () => {
    for (const name of ['browse-manga', 'browse-anime', 'browse-cards', 'browse-decks']) {
      const { navigate, replace } = routerWith();
      const destination = { ...location(name, { page: '2' }, ['search', 'berserk']), hash: '#top' };
      await navigate(destination, location(name, {}, ['search', 'naruto']));
      expect(replace).toHaveBeenCalledOnce();
      expect(replace).toHaveBeenCalledWith({ name, params: { fields: ['search', 'berserk'] }, query: { page: '2' }, hash: '#top', force: true });
    }
  });

  it('replays nothing when the catalog sent a list request before the navigation, as its own push does', async () => {
    const { navigate, replace, routing } = routerWith();
    routing.noteListRequest();
    await navigate(berserk, naruto);
    expect(replace).not.toHaveBeenCalled();
  });

  it('replays nothing when the catalog sent a list request while it took the navigation in', async () => {
    const { finish, replace, routing } = routerWith();
    finish(berserk, naruto);
    routing.noteListRequest();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it('counts the list requests of one navigation only', async () => {
    const { navigate, replace, routing } = routerWith();
    routing.noteListRequest();
    await navigate(berserk, naruto);
    await navigate(location('browse-manga', {}, ['search', 'bleach']), berserk);
    expect(replace).toHaveBeenCalledOnce();
  });

  it('forgets a list request that came with a navigation that failed, as a load of more rows does', async () => {
    const { navigate, replace, routing } = routerWith();
    routing.noteListRequest();
    await navigate(berserk, berserk, { type: 16 });
    await navigate(naruto, berserk);
    expect(replace).toHaveBeenCalledOnce();
  });

  it('replays a move to the plain catalog with the empty list a named route takes, though the router parses the address to an empty string', async () => {
    const { navigate, replace } = routerWith();
    await navigate({ name: 'browse-manga', params: { fields: '' }, query: {} }, naruto);
    expect(replace).toHaveBeenCalledWith({ name: 'browse-manga', params: { fields: [] }, query: {}, hash: undefined, force: true });
    await navigate(location('browse-manga', {}, ['labels', 'romance']), { name: 'browse-manga', params: { fields: '' }, query: {} });
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it('takes an empty string and an empty list for the same plain catalog', async () => {
    const { navigate, replace } = routerWith();
    await navigate(location('browse-manga', {}, []), { name: 'browse-manga', params: { fields: '' }, query: {} });
    await navigate({ name: 'browse-cards', params: {}, query: {} }, location('browse-cards', {}, []));
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves alone a failed navigation, an unchanged list, another page and a move between catalogs', async () => {
    const { navigate, replace } = routerWith();
    await navigate(berserk, naruto, { type: 16 });
    await navigate(location('browse-manga', { page: '2' }, ['search', 'naruto']), naruto);
    await navigate(location('manga-slug', {}, ['x']), naruto);
    await navigate(location('browse-teams', {}, ['search', 'x']), location('browse-teams', {}, []));
    await navigate(location('browse-anime', {}, ['search', 'naruto']), naruto);
    await navigate(naruto, { name: undefined, params: {}, query: {} });
    expect(replace).not.toHaveBeenCalled();
  });

  it('logs a replay the router rejects and goes on replaying', async () => {
    const failure = new Error('guard threw');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { navigate, replace } = routerWith(vi.fn(() => Promise.reject(failure)));
    await navigate(berserk, naruto);
    await navigate(location('browse-manga', {}, ['search', 'bleach']), berserk);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
    expect(logged).toHaveBeenCalledWith('SenkuTools: catalog replay failed', failure);
    expect(replace).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe('installCatalogRouting with a site catalog that sets its own-push flag on every read', () => {
  const siteCatalog = ({ setsFlagOnEveryRead }: { setsFlagOnEveryRead: boolean }) => {
    const hooks: Parameters<PageRouter['afterEach']>[0][] = [];
    const shown: unknown[] = [];
    let requestCount = 0;
    let current = location('browse-manga', {}, ['search', 'naruto']);
    let isOwnPush = setsFlagOnEveryRead;
    const request = (fields: unknown) => {
      shown.push(fields);
      requestCount += 1;
      routing.noteListRequest();
    };
    const read = (fields: unknown) => {
      if (setsFlagOnEveryRead) isOwnPush = true;
      request(fields);
    };
    const go = (target: CatalogLocation, isForced: boolean): Promise<void> => {
      const origin = current;
      if (!isForced && JSON.stringify(target.params.fields) === JSON.stringify(origin.params.fields)) {
        hooks.forEach((hook) => hook(target, origin, { type: 16 }));
        return Promise.resolve();
      }
      const { fields } = target.params;
      current = { ...target, params: { fields: Array.isArray(fields) ? [...(fields as string[])] : fields } };
      if (!Object.is(current.params.fields, origin.params.fields)) queueMicrotask(watchFields);
      hooks.forEach((hook) => hook(current, origin));
      return Promise.resolve();
    };
    const resetFilters = () => {
      isOwnPush = true;
      request([]);
      return go(location('browse-manga', {}, []), false);
    };
    function watchFields() {
      if (isOwnPush) {
        isOwnPush = false;
        return;
      }
      const { fields } = current.params;
      if (Array.isArray(fields) && fields.length > 0) read(fields);
      else void resetFilters();
    }
    shown.push(current.params.fields);
    const replace = vi.fn((target: CatalogReplay) => go(target, target.force));
    const routing = installOn({ beforeEach: () => undefined, afterEach: (hook) => void hooks.push(hook), replace });
    const settled = async (navigation: Promise<void>) => {
      const before = requestCount;
      await navigation;
      await settle();
      return requestCount - before;
    };
    const pushFromOutside = (fields: string[] | '') => settled(go({ name: 'browse-manga', params: { fields }, query: {} }, false));
    const pushOwnFilters = (fields: string[]) =>
      settled(
        Promise.resolve().then(() => {
          isOwnPush = true;
          request(fields);
          return go(location('browse-manga', {}, fields), false);
        })
      );
    const loadMore = () =>
      settled(
        Promise.resolve().then(() => {
          isOwnPush = true;
          request(current.params.fields);
          return go(current, false);
        })
      );
    return { shown, replace, pushFromOutside, pushOwnFilters, loadMore };
  };

  it('shows the list of every address the user goes to with one list request each, though the site skips every other one', async () => {
    const { shown, pushFromOutside } = siteCatalog({ setsFlagOnEveryRead: true });
    for (const fields of [['search', 'berserk'], ['search', 'bleach'], ['search', 'one piece'], '' as const, ['search', 'tokyo'], '' as const]) {
      expect(await pushFromOutside(fields)).toBe(1);
      expect(shown.at(-1)).toEqual(Array.isArray(fields) ? fields : []);
    }
  });

  it('replays nothing and sends one list request after a filter click of the site itself', async () => {
    const { shown, replace, pushFromOutside, pushOwnFilters } = siteCatalog({ setsFlagOnEveryRead: true });
    await pushFromOutside(['search', 'berserk']);
    replace.mockClear();
    expect(await pushOwnFilters(['search', 'berserk', 'labels', 'romance'])).toBe(1);
    expect(replace).not.toHaveBeenCalled();
    expect(shown.at(-1)).toEqual(['search', 'berserk', 'labels', 'romance']);
  });

  it('replays nothing after an outside change the site read by itself', async () => {
    const { shown, replace, pushFromOutside, pushOwnFilters } = siteCatalog({ setsFlagOnEveryRead: true });
    await pushOwnFilters(['search', 'naruto', 'labels', 'romance']);
    replace.mockClear();
    expect(await pushFromOutside(['search', 'berserk'])).toBe(1);
    expect(replace).not.toHaveBeenCalled();
    expect(shown.at(-1)).toEqual(['search', 'berserk']);
  });

  it('replays an outside change the site skipped after it loaded more rows', async () => {
    const { shown, replace, pushFromOutside, pushOwnFilters, loadMore } = siteCatalog({ setsFlagOnEveryRead: true });
    await pushOwnFilters(['search', 'naruto', 'labels', 'romance']);
    expect(await loadMore()).toBe(1);
    replace.mockClear();
    expect(await pushFromOutside(['search', 'bleach'])).toBe(1);
    expect(replace).toHaveBeenCalledOnce();
    expect(shown.at(-1)).toEqual(['search', 'bleach']);
  });

  it('reads each address once and replays nothing once the site sets the flag only for its own push', async () => {
    const { shown, replace, pushFromOutside, pushOwnFilters } = siteCatalog({ setsFlagOnEveryRead: false });
    for (const fields of [
      ['search', 'berserk'],
      ['search', 'bleach'],
    ]) {
      expect(await pushFromOutside(fields)).toBe(1);
      expect(shown.at(-1)).toEqual(fields);
    }
    expect(await pushOwnFilters(['search', 'bleach', 'labels', 'romance'])).toBe(1);
    expect(await pushFromOutside('')).toBe(1);
    expect(shown.at(-1)).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('installCatalogRouting with the client swap', () => {
  const rig = () => {
    const guards: Parameters<PageRouter['beforeEach']>[0][] = [];
    const navigated: Parameters<PageRouter['afterEach']>[0][] = [];
    const router: PageRouter = {
      beforeEach: vi.fn((guard: Parameters<PageRouter['beforeEach']>[0]) => void guards.push(guard)),
      afterEach: vi.fn((hook: Parameters<PageRouter['afterEach']>[0]) => void navigated.push(hook)),
      replace: vi.fn(() => Promise.resolve()),
    };
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const { siteClient } = createCatalogSiteClient({
      catalogAnswers: () => answersOnce([emptyCatalog]),
      answerOwn: (call) => answersOnce([call.document.includes('catalogRowFacts') ? { data: {} } : searchAnswer('naruto')]),
    });
    const clientRef = { __v_isRef: true, value: siteClient as unknown };
    const typed = pageWindow as unknown as Parameters<typeof installClientSwap>[0];
    const install = () =>
      installClientSwap(typed, () => ({ exchangesFor: () => [catalogFallbackExchange(installCatalogRouting(typed.document).isBeforeFirstNavigation)] }));
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
    navigated.forEach((hook) => hook(location('main', {}), { name: undefined, params: {}, query: {} }));
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
