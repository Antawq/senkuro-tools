import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';

import { searchSignal } from '../utils/search/search-event';
import { createSearchPublisher } from '../utils/search/search-exchange';
import { APP_MOUNTED_EVENT, publishAppMounted } from '../utils/shared/app-mounted';
import type { PageWindow } from '../utils/shared/page-window';
import { priceOrderSignal, priceRowsSignal, priceStateSignal, priceViewSignal } from '../utils/shared/price-signal';
import { refreshRequestSignal, refreshResultSignal } from '../utils/shared/refresh-signal';
import { REPLAY_EVENT, TRADES_EVENT, createTradeStore, installCapture, listenForTrades } from '../utils/trades/trade-capture';

const createPage = (): PageWindow => new Window({ url: 'https://senkuro.me/users/sena/cards' }) as unknown as PageWindow;

const detailsHeard = (pageWindow: PageWindow, eventName: string): unknown[] => {
  const details: unknown[] = [];
  pageWindow.document.addEventListener(eventName, (event) => details.push((event as CustomEvent<unknown>).detail));
  return details;
};

const trade = {
  __typename: 'CardTrade',
  id: 't1',
  source: { id: 'u1', name: 'Sena' },
  destination: { id: 'u2', name: 'Miha' },
  offer: [{ quantity: 2, shard: false, card: { slug: 'a' } }],
  request: [{ quantity: 1, shard: true, card: { slug: 'c' } }],
};

describe('cross-world events', () => {
  it('keep the ten event names', () => {
    expect([
      APP_MOUNTED_EVENT,
      priceViewSignal.name,
      priceStateSignal.name,
      priceRowsSignal.name,
      priceOrderSignal.name,
      refreshRequestSignal.name,
      refreshResultSignal.name,
      searchSignal.name,
      TRADES_EVENT,
      REPLAY_EVENT,
    ]).toEqual([
      'senkutools:app-mounted',
      'senkutools:price-view',
      'senkutools:price-state',
      'senkutools:price-rows',
      'senkutools:price-order',
      'senkutools:inventory-refresh',
      'senkutools:inventory-refresh-result',
      'senkutools:search',
      'senkutools:trades',
      'senkutools:trades-replay',
    ]);
  });

  it('send the price view switch as the same text', () => {
    expect(priceViewSignal.encode({ scope: 'grid', isOn: true, sort: 'price' })).toBe('{"scope":"grid","isOn":true,"sort":"price"}');
    expect(priceViewSignal.encode({ scope: 'picker', isOn: false, sort: 'site' })).toBe('{"scope":"picker","isOn":false,"sort":"site"}');
  });

  it('send the price view state as the same text, with and without a total', () => {
    expect(priceStateSignal.encode({ scope: 'picker', name: 'loading', loaded: 40, total: 100 })).toBe(
      '{"scope":"picker","name":"loading","loaded":40,"total":100}'
    );
    expect(priceStateSignal.encode({ scope: 'grid', name: 'failed', loaded: 0, total: null })).toBe('{"scope":"grid","name":"failed","loaded":0,"total":null}');
  });

  it('send the crawled rows and the price order as the same text', () => {
    expect(priceRowsSignal.encode({ scope: 'grid', viewId: 3, slugs: ['a-b', null] })).toBe('{"scope":"grid","viewId":3,"slugs":["a-b",null]}');
    expect(priceOrderSignal.encode({ scope: 'picker', viewId: 3, revision: 2, descending: [1, 0], ascending: [0, 1] })).toBe(
      '{"scope":"picker","viewId":3,"revision":2,"descending":[1,0],"ascending":[0,1]}'
    );
  });

  it('send the refresh request and its result as the same text', () => {
    expect(refreshRequestSignal.encode({ scope: 'grid' })).toBe('{"scope":"grid"}');
    expect(refreshResultSignal.encode({ scope: 'picker', outcome: 'done' })).toBe('{"scope":"picker","outcome":"done"}');
  });

  it('publish a search start and a settled search as the same text', () => {
    const pageWindow = createPage();
    const details = detailsHeard(pageWindow, searchSignal.name);
    const publish = createSearchPublisher(pageWindow);
    publish({ phase: 'start', query: 'наруто', type: 'MANGA' });
    publish({ phase: 'done', query: 'наруто', type: 'MANGA', settled: true, firstSlug: 'naruto' });
    expect(details).toEqual([
      '{"phase":"start","query":"наруто","type":"MANGA"}',
      '{"phase":"done","query":"наруто","type":"MANGA","settled":true,"firstSlug":"naruto"}',
    ]);
  });

  it('publish captured trades as the same text on a replay', () => {
    const pageWindow = createPage();
    const details = detailsHeard(pageWindow, TRADES_EVENT);
    (pageWindow as unknown as { __SENKURO__: unknown }).__SENKURO__ = {
      graphql: { 1: { data: JSON.stringify({ cardTrade: trade, viewer: { user: { id: 'u1' } } }) } },
    };
    installCapture(pageWindow);
    pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(REPLAY_EVENT));
    expect(details).toEqual([
      '{"viewerId":"u1","items":[{"kind":"trade","id":"t1","source":{"id":"u1","name":"Sena"},"destination":{"id":"u2","name":"Miha"},' +
        '"offer":[{"slug":"a","quantity":2,"shard":false}],"request":[{"slug":"c","quantity":1,"shard":true}]}]}',
    ]);
  });

  it('ask for a trades replay and announce the mount with no detail', () => {
    const replayDetails: unknown[] = [];
    document.addEventListener(REPLAY_EVENT, (event) => replayDetails.push((event as CustomEvent<unknown>).detail), { once: true });
    const controller = new AbortController();
    listenForTrades(createTradeStore(), () => undefined, controller.signal);
    controller.abort();
    const pageWindow = createPage();
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {};
    const mountDetails = detailsHeard(pageWindow, APP_MOUNTED_EVENT);
    publishAppMounted(pageWindow);
    expect(replayDetails).toEqual([null]);
    expect(mountDetails).toEqual([null]);
  });
});
