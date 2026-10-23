import '@/assets/tokens.css';
import '@/assets/price-badges.css';
import '@/assets/profile-badge.css';
import '@/assets/site-fixes.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';

import { APP_MOUNTED_EVENT } from '@/utils/shared/app-mounted';
import { loadDatabase } from '@/utils/shared/database';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { createPriceBadges } from '@/utils/badges/price-badges';
import { refreshButtonMissing, syncRefreshButton, type RefreshHost } from '@/utils/profile/inventory-refresh';
import { profileBadgeMissing, removeProfileBadge, updateProfileBadge } from '@/utils/profile/profile-dom';
import { forgetCollection } from '@/utils/profile/profile-store';
import { addedCards, createRenderLoop } from '@/utils/shared/render-loop';
import { loadSettings, watchSettings } from '@/utils/shared/settings';
import { createTokenBar } from '@/utils/token/token-bar';
import { createTradeStore, listenForTrades } from '@/utils/trades/trade-capture';
import { isTradeMutation, updateTradeSummaries } from '@/utils/trades/trade-summary';

const LATE_RENDER_DELAYS_MS = [400, 1500];
const WATCHED_ATTRIBUTES = ['src', 'srcset', 'data-srcset'];
const INVENTORY_REFRESH: RefreshHost = { forget: forgetCollection, reload: () => window.location.reload() };

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
        profile: (db) => {
          updateProfileBadge({ db, valuation: settings, redraw: loop.schedule });
          syncRefreshButton(INVENTORY_REFRESH);
        },
      },
      loadDatabase,
      nextFrame
    );
    const badges = createPriceBadges({ onImageLoad: loop.schedule, touch });

    const observer = new MutationObserver((mutations) => {
      const cards = addedCards(mutations);
      const tradesChanged = mutations.some(isTradeMutation);
      loop.addCards(cards);
      if (tradesChanged) loop.markTrades();
      if (cards.length > 0 || tradesChanged || profileBadgeMissing() || refreshButtonMissing()) loop.schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
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

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      badges.resetPage();
      removeProfileBadge();
      loop.schedule();
      void loop.renderAll();
    });

    ctx.addEventListener(document, APP_MOUNTED_EVENT, loop.schedule);

    listenForTrades(tradeStore, () => {
      loop.markTrades();
      loop.schedule();
    });
    void tokenBar.sync(settings.showToken);
    void loop.renderAll();
    LATE_RENDER_DELAYS_MS.forEach((delay) => ctx.setTimeout(() => void loop.renderAll(), delay));
  },
});
