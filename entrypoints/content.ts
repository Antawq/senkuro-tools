import '@/assets/tokens.css';
import '@/assets/search.css';
import '@/assets/price-badges.css';
import '@/assets/sort.css';
import '@/assets/profile-badge.css';
import '@/assets/shard-switch.css';
import '@/assets/site-fixes.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';

import { APP_MOUNTED_EVENT } from '@/utils/shared/app-mounted';
import { loadDatabase } from '@/utils/shared/database';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { createPriceBadges } from '@/utils/badges/price-badges';
import { isRefreshButtonMissing, syncRefreshButton, type RefreshHost } from '@/utils/profile/inventory-refresh';
import {
  abortProfileLoading,
  forgetProfileBadge,
  handleOutsideClick,
  profileBadgeMissing,
  removeProfileBadge,
  updateProfileBadge,
} from '@/utils/profile/profile-dom';
import { createSearchKeys } from '@/utils/search/search-keys';
import { SEARCH_EVENT } from '@/utils/shared/search-event';
import { createSearchSignals } from '@/utils/search/search-signal';
import { createSearchView } from '@/utils/search/search-view';
import { addedCards, createRenderLoop } from '@/utils/shared/render-loop';
import { PRICE_ORDER_EVENT, PRICE_ROWS_EVENT, PRICE_STATE_EVENT, PRICE_VIEW_EVENT, encodePriceOrder, encodePriceSwitch } from '@/utils/shared/price-signal';
import { isGuardReady, requestInventoryRefresh } from '@/utils/shared/refresh-signal';
import { loadSettings, watchSettings } from '@/utils/shared/settings';
import { createPriceSort, hasSortMutation } from '@/utils/sort/sort-view';
import { createTokenBar } from '@/utils/token/token-bar';
import { createModalRefreshWatcher } from '@/utils/trades/modal-refresh';
import { createShardSwitchWatcher } from '@/utils/trades/shard-switch';
import { createTradeStore, listenForTrades } from '@/utils/trades/trade-capture';
import { isTradeMutation, updateTradeSummaries } from '@/utils/trades/trade-summary';

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
      ctx.requestAnimationFrame(run);
    };
    const inventoryRefresh: RefreshHost = {
      isReady: () => isGuardReady(document),
      refresh: () => requestInventoryRefresh(document, 'grid'),
      forget: forgetProfileBadge,
      reload: () => window.location.reload(),
      redraw: () => loop.schedule(),
    };
    const loop = createRenderLoop(
      {
        cards: (db, cards) => badges.update(db, settings, cards),
        trades: (db) => updateTradeSummaries(db, settings, tradeStore),
        profile: (db) => {
          updateProfileBadge({ db, valuation: settings, redraw: loop.schedule });
          syncRefreshButton(inventoryRefresh);
        },
        sort: (db) => priceSort.sync(db, settings),
      },
      loadDatabase,
      nextFrame
    );
    const badges = createPriceBadges({ touch });
    const priceSort = createPriceSort(document, {
      setView: (isOn) => void document.dispatchEvent(new CustomEvent(PRICE_VIEW_EVENT, { detail: encodePriceSwitch(isOn) })),
      sendOrder: (order) => void document.dispatchEvent(new CustomEvent(PRICE_ORDER_EVENT, { detail: encodePriceOrder(order) })),
      runAfter: (run, delayMs) => void ctx.setTimeout(run, delayMs),
      schedule: loop.schedule,
    });
    const shardSwitches = createShardSwitchWatcher({ nextFrame });
    const modalRefresh = createModalRefreshWatcher({
      isReady: () => isGuardReady(document),
      refresh: () => requestInventoryRefresh(document, 'picker'),
      nextFrame,
    });

    const observer = new MutationObserver((mutations) => {
      const cards = addedCards(mutations);
      const tradesChanged = mutations.some(isTradeMutation);
      shardSwitches.watch(mutations);
      modalRefresh.watch(mutations);
      loop.addCards(cards);
      if (tradesChanged) loop.markTrades();
      if (cards.length > 0 || tradesChanged || profileBadgeMissing() || isRefreshButtonMissing() || hasSortMutation(mutations)) loop.schedule();
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
    const searchHost = {
      runAfter: (run: () => void, delayMs: number) => void ctx.setTimeout(run, delayMs),
      isContextValid: () => !ctx.isInvalid,
      signals: searchSignals,
    };
    const searchKeys = createSearchKeys(document, searchHost);
    const searchView = createSearchView(document, searchHost);
    ctx.addEventListener(document, SEARCH_EVENT, searchSignals.handleEvent);
    ctx.onInvalidated(searchKeys.dispose);
    ctx.onInvalidated(searchView.dispose);
    ctx.addEventListener(document, 'focusin', searchView.syncView, { capture: true });
    ctx.addEventListener(document, 'input', searchView.syncView, { capture: true });
    ctx.addEventListener(document, 'click', searchView.handleClick, { capture: true });
    ctx.addEventListener(document, 'click', priceSort.handleClick, { capture: true });
    ctx.addEventListener(document, PRICE_STATE_EVENT, priceSort.handleState);
    ctx.addEventListener(document, PRICE_ROWS_EVENT, priceSort.handleRows);
    ctx.addEventListener(document, 'keydown', searchKeys.handleKeydown, { capture: true });
    ctx.addEventListener(document, 'input', searchKeys.handleInput, { capture: true });

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      badges.resetPage();
      removeProfileBadge();
      loop.schedule();
      void loop.renderAll();
    });

    ctx.addEventListener(document, APP_MOUNTED_EVENT, loop.schedule);
    ctx.addEventListener(document, 'click', handleOutsideClick);
    ctx.onInvalidated(() => abortProfileLoading());

    listenForTrades(
      tradeStore,
      () => {
        loop.markTrades();
        loop.schedule();
      },
      ctx.signal
    );
    void tokenBar.sync(settings.showToken);
    void loop.renderAll();
  },
});
