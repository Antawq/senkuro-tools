import '@/assets/tokens.css';
import '@/assets/price-badges.css';
import '@/assets/profile-badge.css';
import '@/assets/shard-switch.css';
import '@/assets/site-fixes.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';

import { loadDatabase } from '@/utils/shared/database';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { createPriceBadges } from '@/utils/badges/price-badges';
import { profileBadgeMissing, removeProfileBadge, updateProfileBadge } from '@/utils/profile/profile-dom';
import { addedCards, createRenderLoop } from '@/utils/shared/render-loop';
import { loadSettings, watchSettings } from '@/utils/shared/settings';
import { createTokenBar } from '@/utils/token/token-bar';
import { createShardSwitchWatcher } from '@/utils/trades/shard-switch';
import { createTradeStore, listenForTrades } from '@/utils/trades/trade-capture';
import { isTradeMutation, updateTradeSummaries } from '@/utils/trades/trade-summary';

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
        profile: (db) => updateProfileBadge({ db, valuation: settings, redraw: loop.schedule }),
      },
      loadDatabase,
      nextFrame
    );
    const badges = createPriceBadges({ onImageLoad: loop.schedule, touch });
    const shardSwitches = createShardSwitchWatcher({ nextFrame });

    const observer = new MutationObserver((mutations) => {
      const cards = addedCards(mutations);
      const tradesChanged = mutations.some(isTradeMutation);
      shardSwitches.watch(mutations);
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
