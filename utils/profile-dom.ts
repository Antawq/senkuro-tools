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
  // 1. Desktop: .client-header (the row with nickname header and level badge)
  const clientHeader = document.querySelector('.client-header');
  if (clientHeader) {
    const header = clientHeader.querySelector('header');
    if (header) {
      return {
        container: clientHeader,
        insert: (el) => header.insertAdjacentElement('afterend', el),
      };
    }
    return {
      container: clientHeader,
      insert: (el) => clientHeader.appendChild(el),
    };
  }

  // 2. Direct h1 nickname element
  const h1 = document.querySelector('.client-panel__info h1, h1.caption-size-lg, h1.caption');
  if (h1 && h1.parentElement) {
    return {
      container: h1.parentElement,
      insert: (el) => h1.insertAdjacentElement('afterend', el),
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

function renderLoading(widget: HTMLElement, text: string): void {
  widget.classList.add('senkuro-loading');
  widget.classList.remove('senkuro-error');
  widget.innerHTML = `
    <span class="senkuro-f-icon">💎</span>
    <span class="senkuro-f-text">${text}</span>
  `;
}

function renderError(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  widget.classList.remove('senkuro-loading');
  widget.classList.add('senkuro-error');
  widget.innerHTML = `
    <span class="senkuro-f-icon">💎</span>
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
    <span class="senkuro-f-icon">💎</span>
    <span class="senkuro-f-value">${summary.formattedF}</span>
    <span class="senkuro-f-arrow">▾</span>
  `;

  // Popover details
  const popover = document.createElement('div');
  popover.className = 'senkuro-profile-f-popover';

  let popoverHtml = `
    <div class="senkuro-popover-header">
      <div class="senkuro-popover-title">
        <span class="senkuro-popover-gem">💎</span>
        <span>Ценность карт: <strong>${summary.formattedF}</strong></span>
      </div>
      <button type="button" class="senkuro-popover-refresh" title="Обновить">↻</button>
    </div>
    <div class="senkuro-popover-meta">
      Карт: <strong>${summary.totalCards}</strong> (осколков: <strong>${summary.totalShards}</strong>)
    </div>
    <div class="senkuro-popover-body">
  `;

  if (summary.bank.length > 0) {
    popoverHtml += `
      <div class="senkuro-popover-row">
        <span class="senkuro-row-label">🏛 Банк:</span>
        <span class="senkuro-row-val">${summary.bank.join(' ')}</span>
      </div>
    `;
  }

  if (summary.shards.length > 0) {
    popoverHtml += `
      <div class="senkuro-popover-row">
        <span class="senkuro-row-label">🧩 Осколки:</span>
        <span class="senkuro-row-val">${summary.shards.join(' ')}</span>
      </div>
    `;
  }

  if (summary.rValue) {
    popoverHtml += `
      <div class="senkuro-popover-row senkuro-row-r">
        <span class="senkuro-row-label">⭐ Ранг R:</span>
        <span class="senkuro-row-val">${summary.rValue} (${summary.rCards} шт)</span>
      </div>
    `;
  }

  popoverHtml += `</div>`;
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
