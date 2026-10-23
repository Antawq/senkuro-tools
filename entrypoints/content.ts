import '@/assets/tokens.css';
import '@/assets/better-search.css';
import '@/assets/price-badges.css';
import '@/assets/price-sort.css';
import '@/assets/profile-badge.css';
import '@/assets/site-fixes.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';

import { loadDatabase } from '@/utils/shared/database';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { createPriceBadges } from '@/utils/badges/price-badges';
import { profileBadgeMissing, removeProfileBadge, updateProfileBadge } from '@/utils/profile/profile-dom';
import { createSearchKeys } from '@/utils/search/search-keys';
import { SEARCH_EVENT, createSearchSignals } from '@/utils/search/search-signal';
import { createSearchView } from '@/utils/search/search-view';
import { addedCards, createRenderLoop } from '@/utils/shared/render-loop';
import { LIST_LOAD_EVENT, LIST_LOADED_EVENT } from '@/utils/shared/list-signal';
import { loadSettings, watchSettings } from '@/utils/shared/settings';
import { createPriceSort, touchesSort } from '@/utils/sort/sort-view';
import { createTokenBar } from '@/utils/token/token-bar';
import { createTradeStore, listenForTrades } from '@/utils/trades/trade-capture';
import { isTradeMutation, updateTradeSummaries } from '@/utils/trades/trade-summary';

const LATE_RENDER_DELAYS_MS = [400, 1500];

const applySummaryFontSize = (size: number) => document.documentElement.style.setProperty('--senkuro-summary-font-size', `${size}px`);

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_idle',
  async main(ctx) {
    const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    let settings = await loadSettings();
    applySummaryFontSize(settings.summaryFontSize);
    const tradeStore = createTradeStore();
    const tokenBar = createTokenBar(ctx);

    const nextFrame = (run: () => void) => {
      if (ctx.isInvalid) return;
      if ('requestAnimationFrame' in window) ctx.requestAnimationFrame(run);
      else ctx.setTimeout(run, 0);
    };
    const loop = createRenderLoop(
      {
        cards: (db, cards) => badges.update(db, settings, cards),
        trades: (db) => updateTradeSummaries(db, settings, tradeStore),
        profile: (db) => updateProfileBadge({ db, valuation: settings, redraw: loop.schedule }),
        sort: (db) => priceSort.sync(db, settings),
      },
      loadDatabase,
      nextFrame
    );
    const badges = createPriceBadges({ touch });
    const priceSort = createPriceSort(document, {
      request: () => void document.dispatchEvent(new CustomEvent(LIST_LOAD_EVENT)),
      later: (run, ms) => void ctx.setTimeout(run, ms),
      schedule: loop.schedule,
    });

    const observer = new MutationObserver((mutations) => {
      const cards = addedCards(mutations);
      const tradesChanged = mutations.some(isTradeMutation);
      loop.addCards(cards);
      if (tradesChanged) loop.markTrades();
      if (cards.length > 0 || tradesChanged || profileBadgeMissing() || touchesSort(mutations)) loop.schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    ctx.onInvalidated(() => observer.disconnect());

    ctx.onInvalidated(
      watchSettings(settings, (next, key) => {
        settings = next;
        if (key === 'showToken') {
          void tokenBar.sync(next.showToken);
          return;
        }
        if (key === 'summaryFontSize') {
          applySummaryFontSize(next.summaryFontSize);
          return;
        }
        badges.reset();
        void loop.renderAll();
      })
    );

    const searchSignals = createSearchSignals();
    const searchHost = { later: (run: () => void, ms: number) => void ctx.setTimeout(run, ms), alive: () => !ctx.isInvalid, signals: searchSignals };
    const searchKeys = createSearchKeys(document, searchHost);
    const searchView = createSearchView(document, searchHost);
    ctx.addEventListener(document, SEARCH_EVENT, searchSignals.event);
    ctx.onInvalidated(searchKeys.dispose);
    ctx.onInvalidated(searchView.dispose);
    ctx.addEventListener(document, 'focusin', searchView.touch, { capture: true });
    ctx.addEventListener(document, 'input', searchView.touch, { capture: true });
    ctx.addEventListener(document, 'click', searchView.click, { capture: true });
    ctx.addEventListener(document, 'click', priceSort.click, { capture: true });
    ctx.addEventListener(document, LIST_LOADED_EVENT, priceSort.loaded);
    ctx.addEventListener(document, 'keydown', searchKeys.keydown, { capture: true });
    ctx.addEventListener(document, 'input', searchKeys.input, { capture: true });

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      badges.resetPage();
      removeProfileBadge();
      loop.schedule();
      void loop.renderAll();
    });

    listenForTrades(tradeStore, () => {
      loop.markTrades();
      loop.schedule();
    });
    void tokenBar.sync(settings.showToken);
    void loop.renderAll();
    LATE_RENDER_DELAYS_MS.forEach((delay) => ctx.setTimeout(() => void loop.renderAll(), delay));
  },
});
