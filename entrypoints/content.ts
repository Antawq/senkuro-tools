import '@/assets/tokens.css';
import '@/assets/search.css';
import '@/assets/price-badges.css';
import '@/assets/sort.css';
import '@/assets/profile-badge.css';
import '@/assets/shard-switch.css';
import '@/assets/paging-sentinel.css';
import '@/assets/toolbar-panel.css';
import '@/assets/lock-filter.css';
import '@/assets/modal-search.css';
import '@/assets/modal-filters.css';
import '@/assets/site-fixes.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import '@/assets/trade-meta.css';
import '@/assets/poster.css';
import { defineContentScript } from '#imports';

import { APP_MOUNTED_EVENT, isAppMounted } from '@/utils/shared/app-mounted';
import { loadDatabase, type Database } from '@/utils/shared/database';
import { createFilterMemory, type PlaceMemory } from '@/utils/shared/filter-memory';
import { createFrameWait } from '@/utils/shared/frame-wait';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { createPriceBadges } from '@/utils/badges/price-badges';
import { isPosterButtonMissing, syncPosterButton, type PosterButtonHost } from '@/utils/poster/poster-button';
import { closeStalePosterDialogs, openPosterDialog } from '@/utils/poster/poster-dialog';
import { createPosterDialogHost } from '@/utils/poster/poster-host';
import { isInventorySearchMissing, syncInventorySearch } from '@/utils/profile/inventory-search';
import { isRefreshButtonMissing, syncRefreshButton, type RefreshHost } from '@/utils/profile/inventory-refresh';
import {
  abortProfileLoading,
  forgetProfileBadge,
  handleOutsideClick,
  profileBadgeMissing,
  removeProfileBadge,
  updateProfileBadge,
} from '@/utils/profile/profile-dom';
import { fetchProfileUser } from '@/utils/profile/profile-cards';
import { createSearchKeys } from '@/utils/search/search-keys';
import { searchSignal } from '@/utils/search/search-event';
import { createSearchSignals } from '@/utils/search/search-signal';
import { createSearchView } from '@/utils/search/search-view';
import { LIST_SCOPES } from '@/utils/shared/list-scope';
import { addedCards, createRenderLoop } from '@/utils/shared/render-loop';
import { priceOrderSignal, priceRowsSignal, priceStateSignal, priceViewSignal } from '@/utils/shared/price-signal';
import { isGuardReady, requestInventoryRefresh } from '@/utils/shared/refresh-signal';
import { loadSettings, watchSettings } from '@/utils/shared/settings';
import { closeToolbarPanels } from '@/utils/shared/toolbar-panel';
import { TOOLBAR } from '@/utils/shared/trade-modal';
import { createMemoryCapture } from '@/utils/sort/memory-capture';
import { createMemoryRestore } from '@/utils/sort/memory-restore';
import { memoryPlaceOf } from '@/utils/sort/sort-places';
import { canDrawRangeControls, createPriceSort, hasSortMutation } from '@/utils/sort/sort-view';
import { createTokenBar } from '@/utils/token/token-bar';
import { createModalFiltersWatcher } from '@/utils/trades/modal-filters';
import { createModalRefreshWatcher } from '@/utils/trades/modal-refresh';
import { createShardSwitchWatcher, SHARD_VIEW_ATTRIBUTE } from '@/utils/trades/shard-switch';
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
    const posterButtonHost: PosterButtonHost = {
      openDialog: (cards, profileSlug) =>
        void loadDatabase().then((loadedDatabase) =>
          openPosterDialog(
            cards,
            profileSlug,
            createPosterDialogHost({
              pageDocument: document,
              database: loadedDatabase,
              settings,
              fetchNickname: (slug, signal) => fetchProfileUser(slug, undefined, signal).then((user) => user?.name ?? null),
              nextFrame,
            })
          )
        ),
    };
    const loop = createRenderLoop(
      [
        { name: 'cards', trigger: 'cards', render: (db, cards) => badges.update(db, settings, cards) },
        { name: 'trades', trigger: 'trades', render: (db) => updateTradeSummaries(db, settings, tradeStore) },
        {
          name: 'profile',
          render: (db) => {
            updateProfileBadge({ db, valuation: settings, redraw: loop.schedule });
            syncRefreshButton(inventoryRefresh);
          },
        },
        {
          name: 'sort',
          render: (db) => {
            memoryRestore.sync();
            priceSorts.forEach((priceSort) => priceSort.sync(db, settings));
          },
        },
        { name: 'poster', render: () => syncPosterButton(document, posterButtonHost) },
        { name: 'inventorySearch', render: (db) => syncInventorySearch(document, db) },
      ],
      loadDatabase,
      nextFrame
    );
    const badges = createPriceBadges({ touch });
    const filterMemory = createFilterMemory();
    const memoryCapture = createMemoryCapture(document, filterMemory, { nextFrame });
    const rememberOnToolbar = (toolbar: Element | null, patch: Partial<PlaceMemory>) => {
      if (!toolbar) return;
      memoryCapture.touch(toolbar);
      const place = memoryPlaceOf(toolbar);
      if (place) filterMemory.update(place, patch);
    };
    const priceSorts = LIST_SCOPES.map((scope) =>
      createPriceSort(document, scope, {
        setView: (isOn, sort) => void document.dispatchEvent(new CustomEvent(priceViewSignal.name, { detail: priceViewSignal.encode({ scope, isOn, sort }) })),
        sendOrder: (order) => void document.dispatchEvent(new CustomEvent(priceOrderSignal.name, { detail: priceOrderSignal.encode({ scope, ...order }) })),
        runAfter: (run, delayMs) => void ctx.setTimeout(run, delayMs),
        schedule: loop.schedule,
        rememberRange: (toolbar, range) => rememberOnToolbar(toolbar, { range }),
      })
    );
    let database: Database = {};
    const shardSwitches = createShardSwitchWatcher({
      nextFrame,
      onSelect: (modal, shardView) => rememberOnToolbar(modal.querySelector(TOOLBAR), { shardView }),
    });
    const modalFilters = createModalFiltersWatcher({
      nextFrame,
      getDatabase: () => database,
      onLockChange: (toolbar, lock) => rememberOnToolbar(toolbar, { lock }),
    });
    const memoryRestore = createMemoryRestore(document, filterMemory, {
      isReady: () => isAppMounted(document),
      hasTouched: memoryCapture.hasTouched,
      wait: createFrameWait(nextFrame),
      restoreOwn: (toolbar, saved) => {
        for (const priceSort of priceSorts) {
          if (saved.sort === 'price') priceSort.applyPriceSort(toolbar);
          if (saved.range !== null && canDrawRangeControls(document)) priceSort.applyRange(toolbar, saved.range);
        }
        if (saved.shardView !== null) shardSwitches.applyView(toolbar, saved.shardView);
        if (saved.lock !== null) modalFilters.applyLock(toolbar, saved.lock);
      },
    });
    const modalRefresh = createModalRefreshWatcher({
      isReady: () => isGuardReady(document),
      refresh: () => requestInventoryRefresh(document, 'picker'),
      nextFrame,
    });

    const observer = new MutationObserver((mutations) => {
      const cards = addedCards(mutations);
      const tradesChanged = mutations.some(isTradeMutation);
      shardSwitches.watch(mutations);
      modalFilters.watch(mutations);
      modalRefresh.watch(mutations);
      loop.addCards(cards);
      if (tradesChanged) loop.markTrades();
      if (
        cards.length > 0 ||
        tradesChanged ||
        profileBadgeMissing() ||
        isRefreshButtonMissing() ||
        isPosterButtonMissing(document) ||
        isInventorySearchMissing(document) ||
        hasSortMutation(mutations)
      )
        loop.schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributeFilter: [SHARD_VIEW_ATTRIBUTE] });
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
    ctx.addEventListener(document, searchSignal.name, searchSignals.handleEvent);
    ctx.onInvalidated(searchKeys.dispose);
    ctx.onInvalidated(searchView.dispose);
    ctx.addEventListener(document, 'focusin', searchView.syncView, { capture: true });
    ctx.addEventListener(document, 'input', searchView.syncView, { capture: true });
    ctx.addEventListener(document, 'click', searchView.handleClick, { capture: true });
    ctx.addEventListener(document, 'click', memoryCapture.handleClick, { capture: true });
    ctx.addEventListener(document, 'pointerdown', (event) => closeToolbarPanels(document, event.target), { capture: true });
    for (const priceSort of priceSorts) {
      ctx.addEventListener(document, 'click', priceSort.handleClick, { capture: true });
      ctx.addEventListener(document, priceStateSignal.name, priceSort.handleState);
      ctx.addEventListener(document, priceRowsSignal.name, priceSort.handleRows);
    }
    ctx.addEventListener(document, 'keydown', searchKeys.handleKeydown, { capture: true });
    ctx.addEventListener(document, 'input', searchKeys.handleInput, { capture: true });

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      badges.resetPage();
      removeProfileBadge();
      closeStalePosterDialogs(document);
      loop.schedule();
      void loop.renderAll();
    });

    ctx.addEventListener(document, APP_MOUNTED_EVENT, () => void loop.renderAll());
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
    void filterMemory.load().then(() => loop.schedule());
    void loop.renderAll();
    void loadDatabase().then((loaded) => {
      database = loaded;
      if (!ctx.isInvalid) {
        modalFilters.sync();
        syncInventorySearch(document, database);
      }
    });
  },
});
