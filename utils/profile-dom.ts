import type { Database } from './database';
import { calculateProfileValue, extractProfileSlug, fetchProfileCards, fetchProfileUser, type ProfileValueSummary } from './profile-cards';

export const WIDGET_ID = 'senkuro-profile-card-value';
const CACHE_PREFIX = 'senkutools:profile_f:';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface ProfileBadgeDeps {
  db: Database;
  commission: boolean;
}

interface CacheEntry {
  summary: ProfileValueSummary;
  timestamp: number;
}

const inProgress = new Set<string>();

function getCached(slug: string): ProfileValueSummary | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${slug}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${slug}`);
      return null;
    }
    return entry.summary;
  } catch {
    return null;
  }
}

function setCached(slug: string, summary: ProfileValueSummary): void {
  try {
    const entry: CacheEntry = { summary, timestamp: Date.now() };
    sessionStorage.setItem(`${CACHE_PREFIX}${slug}`, JSON.stringify(entry));
  } catch {
    // sessionStorage quota or disabled
  }
}

function clearCached(slug: string): void {
  try {
    sessionStorage.removeItem(`${CACHE_PREFIX}${slug}`);
  } catch {
    // ignore
  }
}

interface NicknameTarget {
  container: Element;
  insert: (el: HTMLElement) => void;
}

export function findNicknameTarget(): NicknameTarget | null {
  // 1. Directly right after h1 inside the nickname header
  const h1 = document.querySelector(
    '.client-header header h1, .client-header h1, .client-panel__info h1, h1.caption-size-lg, h1.caption'
  );
  if (h1 && h1.parentElement) {
    return {
      container: h1.parentElement,
      insert: (el) => h1.insertAdjacentElement('afterend', el),
    };
  }

  // 2. Desktop: .client-header header (inside the header container)
  const header = document.querySelector('.client-header header');
  if (header) {
    return {
      container: header,
      insert: (el) => header.appendChild(el),
    };
  }

  // 3. Desktop: .client-header
  const clientHeader = document.querySelector('.client-header');
  if (clientHeader) {
    return {
      container: clientHeader,
      insert: (el) => clientHeader.appendChild(el),
    };
  }

  // 3. Mobile top bar: .nav-mobile__left
  const navMobile = document.querySelector('.nav-mobile__left');
  if (navMobile) {
    return {
      container: navMobile,
      insert: (el) => navMobile.appendChild(el),
    };
  }

  // 4. Fallback: .client-panel__info
  const panelInfo = document.querySelector('.client-panel__info');
  if (panelInfo) {
    return {
      container: panelInfo,
      insert: (el) => panelInfo.prepend(el),
    };
  }

  return null;
}

export function removeProfileBadge(): void {
  document.getElementById(WIDGET_ID)?.remove();
}

export function updateProfileBadge(deps: ProfileBadgeDeps): void {
  const slug = extractProfileSlug(window.location.pathname);
  if (!slug) {
    removeProfileBadge();
    return;
  }

  let widget = document.getElementById(WIDGET_ID);
  const target = findNicknameTarget();
  if (!target) return;

  if (widget) {
    // If widget exists but for another slug, reset it
    if (widget.dataset.slug !== slug) {
      widget.dataset.slug = slug;
      widget.remove();
      widget = null;
    } else {
      // Check if widget is still connected in current target
      if (!target.container.contains(widget)) {
        target.insert(widget);
      }
      return;
    }
  }

  widget = document.createElement('div');
  widget.id = WIDGET_ID;
  widget.className = 'senkuro-profile-f-chip';
  widget.dataset.slug = slug;
  target.insert(widget);

  const cached = getCached(slug);
  if (cached) {
    renderSummary(widget, slug, cached, deps);
  } else {
    renderLoading(widget, 'Считаем F...');
    triggerFetch(widget, slug, deps);
  }
}

const CARD_ICON = `<svg class="senkuro-chip-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="8.5" height="10.5" rx="1.5"/><path d="M5.5 1.5h6.5A1.5 1.5 0 0 1 13.5 3v8"/></svg>`;

const CHEVRON_ICON = `<svg class="senkuro-chip-arrow" viewBox="0 0 10 6" width="9" height="6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m1 1 4 4 4-4"/></svg>`;

const REFRESH_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 6M13.5 2.5V6h-3.5M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10M2.5 13.5V10H6"/></svg>`;

export function combineWithRFirst(primary: string[], shards: string[]): string[] {
  const all = [...primary, ...shards];
  if (all.length === 0) return [];
  const rItems = all.filter((item) => item.endsWith('R') || item.includes('R'));
  const otherItems = all.filter((item) => !item.endsWith('R') && !item.includes('R'));
  return [...rItems, ...otherItems];
}

function formatRanksWithHighlight(items: string[]): string {
  if (items.length === 0) return '—';
  return items
    .map((item) => (item.endsWith('R') || item.includes('R') ? `<span class="senkuro-rank-r">${item}</span>` : item))
    .join(' ');
}

function renderLoading(widget: HTMLElement, text: string): void {
  widget.classList.add('senkuro-loading');
  widget.classList.remove('senkuro-error');
  widget.innerHTML = `
    <span class="senkuro-chip-spinner"></span>
    <span class="senkuro-f-text">${text}</span>
  `;
}

function renderError(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  widget.classList.remove('senkuro-loading');
  widget.classList.add('senkuro-error');
  widget.innerHTML = `
    ${CARD_ICON}
    <span class="senkuro-f-text">F: ошибка (повторить)</span>
  `;
  widget.onclick = (e) => {
    e.stopPropagation();
    clearCached(slug);
    renderLoading(widget, 'Повтор...');
    triggerFetch(widget, slug, deps);
  };
}

function renderSummary(
  widget: HTMLElement,
  slug: string,
  summary: ProfileValueSummary,
  deps: ProfileBadgeDeps
): void {
  widget.classList.remove('senkuro-loading', 'senkuro-error');
  widget.innerHTML = '';

  const mainChip = document.createElement('div');
  mainChip.className = 'senkuro-f-chip-content';
  mainChip.innerHTML = `
    ${CARD_ICON}
    <span class="senkuro-f-value">${summary.formattedF}</span>
    ${CHEVRON_ICON}
  `;

  // Popover details
  const popover = document.createElement('div');
  popover.className = 'senkuro-profile-f-popover';

  const bankCombined = combineWithRFirst(summary.bank, summary.shards);
  const bankDisplay = formatRanksWithHighlight(bankCombined);

  const cardsCombined = combineWithRFirst(summary.cards, summary.shards);
  const cardsDisplay = formatRanksWithHighlight(cardsCombined);

  const popoverHtml = `
    <div class="senkuro-popover-header">
      <div class="senkuro-popover-title">
        ${CARD_ICON}
        <span>Ценность: <strong class="senkuro-f-accent">${summary.formattedF}</strong></span>
      </div>
      <button type="button" class="senkuro-popover-refresh" title="Обновить">${REFRESH_ICON}</button>
    </div>
    <div class="senkuro-popover-meta">
      Всего: <strong>${summary.totalCards}</strong> карт${summary.totalShards > 0 ? ` · <strong>${summary.totalShards}</strong> осколков` : ''}
    </div>
    <div class="senkuro-popover-body">
      <div class="senkuro-popover-row">
        <span class="senkuro-row-label">Банк:</span>
        <span class="senkuro-row-val">${bankDisplay}</span>
      </div>
      <div class="senkuro-popover-row">
        <span class="senkuro-row-label">Карты:</span>
        <span class="senkuro-row-val">${cardsDisplay}</span>
      </div>
    </div>
  `;
  popover.innerHTML = popoverHtml;

  widget.append(mainChip, popover);

  // Toggle popover on click
  mainChip.onclick = (e) => {
    e.stopPropagation();
    const isActive = widget.classList.contains('senkuro-popover-active');
    document.querySelectorAll('.senkuro-popover-active').forEach((el) => {
      if (el !== widget) el.classList.remove('senkuro-popover-active');
    });
    if (isActive) {
      widget.classList.remove('senkuro-popover-active');
    } else {
      widget.classList.add('senkuro-popover-active');
    }
  };

  const refreshBtn = popover.querySelector('.senkuro-popover-refresh') as HTMLButtonElement | null;
  if (refreshBtn) {
    refreshBtn.onclick = (e) => {
      e.stopPropagation();
      widget.classList.remove('senkuro-popover-active');
      clearCached(slug);
      renderLoading(widget, 'Обновление...');
      triggerFetch(widget, slug, deps);
    };
  }

  // Close popover when clicking anywhere outside
  const onDocClick = (e: MouseEvent) => {
    if (!widget.contains(e.target as Node)) {
      widget.classList.remove('senkuro-popover-active');
    }
  };
  document.addEventListener('click', onDocClick);
}

function triggerFetch(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  if (inProgress.has(slug)) return;
  inProgress.add(slug);

  (async () => {
    try {
      const user = await fetchProfileUser(slug);
      if (!user) {
        renderError(widget, slug, deps);
        return;
      }

      const cards = await fetchProfileCards(user.id, (loaded) => {
        if (widget.dataset.slug === slug && widget.classList.contains('senkuro-loading')) {
          renderLoading(widget, `Карт: ${loaded}...`);
        }
      });

      const summary = calculateProfileValue(cards, deps.db, deps.commission);
      setCached(slug, summary);

      if (widget.dataset.slug === slug) {
        renderSummary(widget, slug, summary, deps);
      }
    } catch (err) {
      console.error('SenkuTools: failed to fetch profile cards', err);
      if (widget.dataset.slug === slug) {
        renderError(widget, slug, deps);
      }
    } finally {
      inProgress.delete(slug);
    }
  })();
}
