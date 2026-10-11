import '@/assets/price-badges.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';

import { loadDatabase } from '@/utils/database';
import { SENKURO_MATCHES } from '@/utils/hosts';
import { createPriceBadges } from '@/utils/price-badges';
import { loadSettings, watchSettings } from '@/utils/settings';
import { createTokenBar } from '@/utils/token-bar';
import { createTradeStore, listenForTrades } from '@/utils/trade-capture';
import { isTradeMutation, updateTradeSummaries } from '@/utils/trade-summary';

const MUTATION_DEBOUNCE_MS = 250;
const IDLE_TIMEOUT_MS = 500;
const LATE_RENDER_DELAYS_MS = [1500, 4000];
const WATCHED_ATTRIBUTES = ['src', 'srcset', 'data-srcset'];

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_idle',
  async main(ctx) {
    const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    let settings = await loadSettings();
    const tradeStore = createTradeStore();
    const tokenBar = createTokenBar(ctx);
    let scheduled = false;
    
    document.documentElement.style.setProperty('--senkuro-summary-font-size', `${settings.summaryFontSize}px`);
    let rendering = false;

    const render = async () => {
      scheduled = false;
      rendering = true;
      try {
        const db = await loadDatabase();
        badges.update(db, settings);
        updateTradeSummaries(
          db,
          {
            commission: settings.commission,
            valueBySplit: settings.valueBySplit,
            showSummaryF: settings.showSummaryF,
            showSummaryBank: settings.showSummaryBank,
            showSummaryCards: settings.showSummaryCards,
            showSummaryVerdict: settings.showSummaryVerdict,
          },
          tradeStore
        );
      } finally {
        rendering = false;
      }
    };

    const schedule = () => {
      if (scheduled || ctx.isInvalid) return;
      scheduled = true;
      if (!touch && 'requestIdleCallback' in window) ctx.requestIdleCallback(() => void render(), { timeout: IDLE_TIMEOUT_MS });
      else ctx.setTimeout(() => void render(), 0);
    };

    const badges = createPriceBadges({ onImageLoad: schedule, touch });

    let debounce: number | undefined;
    const observer = new MutationObserver((mutations) => {
      if (rendering) return;
      if (!mutations.some((mutation) => mutation.addedNodes.length > 0 || mutation.type === 'attributes' || isTradeMutation(mutation))) return;
      clearTimeout(debounce);
      debounce = ctx.setTimeout(schedule, MUTATION_DEBOUNCE_MS);
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
          document.documentElement.style.setProperty('--senkuro-summary-font-size', `${next.summaryFontSize}px`);
          return;
        }
        badges.reset();
        schedule();
      })
    );

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      badges.resetPage();
      schedule();
    });

    listenForTrades(tradeStore, schedule);
    void tokenBar.sync(settings.showToken);
    schedule();
    LATE_RENDER_DELAYS_MS.forEach((delay) => ctx.setTimeout(schedule, delay));
  },
});
