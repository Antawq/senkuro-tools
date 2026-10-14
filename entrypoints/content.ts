import '@/assets/tokens.css';
import '@/assets/price-badges.css';
import '@/assets/profile-badge.css';
import '@/assets/token-bar.css';
import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';

import { answerTokenRequests } from '@/utils/access-token';
import { CARD_LINK } from '@/utils/cards';
import { loadDatabase } from '@/utils/database';
import { SENKURO_MATCHES } from '@/utils/hosts';
import { createPriceBadges } from '@/utils/price-badges';
import { extractProfileSlug } from '@/utils/profile-cards';
import { removeProfileBadge, updateProfileBadge, WIDGET_ID } from '@/utils/profile-dom';
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
    ctx.onInvalidated(answerTokenRequests());
    const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    let settings = await loadSettings();
    applySummaryFontSize(settings.summaryFontSize);
    const tradeStore = createTradeStore();
    const tokenBar = createTokenBar(ctx);

    const cardQueue = new Set<HTMLAnchorElement>();
    let tradeDirty = false;
    let scheduled = false;

    const getSummarySettings = () => ({
      commission: settings.commission,
      valueBySplit: settings.valueBySplit,
      valueBasis: settings.valueBasis,
      showSummaryF: settings.showSummaryF,
      showSummaryBank: settings.showSummaryBank,
      showSummaryCards: settings.showSummaryCards,
      showSummaryVerdict: settings.showSummaryVerdict,
    });

    const flush = async () => {
      scheduled = false;
      const batch = cardQueue.size > 0 ? Array.from(cardQueue) : null;
      cardQueue.clear();
      const shouldUpdateTrades = tradeDirty;
      tradeDirty = false;

      try {
        const db = await loadDatabase();
        if (batch) badges.update(db, settings, batch);
        if (shouldUpdateTrades) updateTradeSummaries(db, getSummarySettings(), tradeStore);
        updateProfileBadge({ db, valuation: getSummarySettings() });
      } catch (err) {
        console.error('SenkuTools: batch render error', err);
      }
    };

    const scheduleBatch = () => {
      if (scheduled || ctx.isInvalid) return;
      scheduled = true;
      if ('requestAnimationFrame' in window) ctx.requestAnimationFrame(() => void flush());
      else ctx.setTimeout(() => void flush(), 0);
    };

    const renderAll = async () => {
      cardQueue.clear();
      tradeDirty = false;
      try {
        const db = await loadDatabase();
        badges.update(db, settings);
        updateTradeSummaries(db, getSummarySettings(), tradeStore);
        updateProfileBadge({ db, valuation: getSummarySettings() });
      } catch (err) {
        console.error('SenkuTools: render error', err);
      }
    };

    const badges = createPriceBadges({ onImageLoad: scheduleBatch, touch });

    const observer = new MutationObserver((mutations) => {
      let hasNewCards = false;
      for (const m of mutations) {
        if (!tradeDirty && isTradeMutation(m)) tradeDirty = true;
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.matches(CARD_LINK)) {
              cardQueue.add(node as HTMLAnchorElement);
              hasNewCards = true;
            }
            node.querySelectorAll<HTMLAnchorElement>(CARD_LINK).forEach((card) => {
              cardQueue.add(card);
              hasNewCards = true;
            });
          }
        }
      }
      const slug = extractProfileSlug(window.location.pathname);
      const profileNeedsMount = Boolean(slug && !document.getElementById(WIDGET_ID));
      if (hasNewCards || tradeDirty || profileNeedsMount) {
        scheduleBatch();
      }
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
        void renderAll();
      })
    );

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      badges.resetPage();
      removeProfileBadge();
      scheduleBatch();
      void renderAll();
    });

    listenForTrades(tradeStore, () => {
      tradeDirty = true;
      scheduleBatch();
    });
    void tokenBar.sync(settings.showToken);
    void renderAll();
    LATE_RENDER_DELAYS_MS.forEach((delay) => ctx.setTimeout(() => void renderAll(), delay));
  },
});
