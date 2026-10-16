import '@/assets/tokens.css';
import '@/assets/price-badges.css';
import '@/assets/profile-badge.css';
import '@/assets/site-fixes.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';

import { loadDatabase } from '@/utils/database';
import { SENKURO_MATCHES } from '@/utils/hosts';
import { createPriceBadges } from '@/utils/price-badges';
import { profileBadgeMissing, removeProfileBadge, updateProfileBadge } from '@/utils/profile-dom';
import { addedCards, createRenderLoop } from '@/utils/render-loop';
import { loadSettings, watchSettings } from '@/utils/settings';
import { createTokenBar } from '@/utils/token-bar';
import { createTradeStore, listenForTrades } from '@/utils/trade-capture';
import { isTradeMutation, updateTradeSummaries } from '@/utils/trade-summary';

const LATE_RENDER_DELAYS_MS = [400, 1500];
const WATCHED_ATTRIBUTES = ['src', 'srcset', 'data-srcset'];

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
        profile: (db) => updateProfileBadge({ db, valuation: settings }),
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
      if (cards.length > 0 || tradesChanged || profileBadgeMissing()) loop.schedule();
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

    listenForTrades(tradeStore, () => {
      loop.markTrades();
      loop.schedule();
    });
    void tokenBar.sync(settings.showToken);
    void loop.renderAll();
    LATE_RENDER_DELAYS_MS.forEach((delay) => ctx.setTimeout(() => void loop.renderAll(), delay));
  },
});
