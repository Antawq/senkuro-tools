import { packCards, unpackCards } from './account-cache';
import type { AccountCard } from './account-cards';
import type { Database } from './database';
import { calculateProfileValue, extractProfileSlug, fetchProfileCards, fetchProfileUser, type ProfileValueSummary } from './profile-cards';
import { svgIcon } from './svg';
import { MS_PER_MINUTE } from './time';
import { R_RANK, type Valuation } from './trade-value';

export const WIDGET_ID = 'senkuro-profile-card-value';

const CHIP = 'senkuro-profile-f-chip';
const LOADING = 'senkuro-loading';
const FAILED = 'senkuro-error';
const ACTIVE = 'senkuro-popover-active';
const R_HIGHLIGHT = 'senkuro-rank-r';
const GUTTER_PROPERTY = '--senkuro-gutter';
const SHIFT_PROPERTY = '--senkuro-popover-shift';
const CACHE_PREFIX = 'senkutools:profile_cards:';
const CACHE_TTL_MINUTES = 10;
const CACHE_TTL_MS = CACHE_TTL_MINUTES * MS_PER_MINUTE;
const EMPTY = '-';

const TEXT = {
  counting: 'Считаем F...',
  retrying: 'Повтор...',
  refreshing: 'Обновление...',
  failed: 'ошибка (повторить)',
  refresh: 'Обновить',
  value: 'Ценность: ',
  total: 'Всего: ',
  cards: ' карт',
  shards: ' осколков',
  separator: ' · ',
  bankRow: 'Банк:',
  cardsRow: 'Карты:',
} as const;

const progressText = (loaded: number): string => `Карт: ${loaded}...`;

const chevronIcon = (): SVGSVGElement =>
  svgIcon({ class: 'senkuro-chip-arrow', viewBox: '0 0 10 6', width: '9', height: '6', stroke: 'currentColor', 'stroke-width': '1.8' }, [
    ['path', { d: 'm1 1 4 4 4-4' }],
  ]);

const refreshIcon = (): SVGSVGElement =>
  svgIcon({ viewBox: '0 0 16 16', width: '13', height: '13', stroke: 'currentColor', 'stroke-width': '1.7' }, [
    ['path', { d: 'M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 6M13.5 2.5V6h-3.5M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10M2.5 13.5V10H6' }],
  ]);

const NICKNAME_HEADING = '.client-header header h1, .client-header h1, .client-panel__info h1, h1.caption-size-lg, h1.caption';

const NICKNAME_HOSTS: [string, (host: Element, el: HTMLElement) => void][] = [
  ['.client-header header', (host, el) => host.append(el)],
  ['.client-header', (host, el) => host.append(el)],
  ['.nav-mobile__left', (host, el) => host.append(el)],
  ['.client-panel__info', (host, el) => host.prepend(el)],
];

export interface ProfileBadgeDeps {
  db: Database;
  valuation: Valuation;
}

interface NicknameTarget {
  container: Element;
  insert: (el: HTMLElement) => void;
}

interface CacheEntry {
  at?: unknown;
  cards?: unknown;
}

const inProgress = new Set<string>();
let closingBound = false;

const cacheKey = (slug: string): string => `${CACHE_PREFIX}${slug}`;

const valuationKey = ({ commission, valueBySplit, valueBasis }: Valuation): string => JSON.stringify([commission, valueBySplit, valueBasis]);

function readCache(slug: string): AccountCard[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(slug));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (typeof entry.at !== 'number' || Date.now() - entry.at > CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey(slug));
      return null;
    }
    return unpackCards(entry.cards);
  } catch {
    return null;
  }
}

function writeCache(slug: string, cards: AccountCard[]): void {
  try {
    sessionStorage.setItem(cacheKey(slug), JSON.stringify({ at: Date.now(), cards: packCards(cards) }));
  } catch (error) {
    console.warn('SenkuTools: profile cache', error);
  }
}

function clearCache(slug: string): void {
  try {
    sessionStorage.removeItem(cacheKey(slug));
  } catch (error) {
    console.warn('SenkuTools: profile cache', error);
  }
}

export function findNicknameTarget(): NicknameTarget | null {
  const heading = document.querySelector(NICKNAME_HEADING);
  if (heading?.parentElement) return { container: heading.parentElement, insert: (el) => heading.insertAdjacentElement('afterend', el) };
  for (const [selector, insert] of NICKNAME_HOSTS) {
    const host = document.querySelector(selector);
    if (host) return { container: host, insert: (el) => insert(host, el) };
  }
  return null;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const isR = (item: string): boolean => item.endsWith(R_RANK);

const rFirst = (items: string[]): string[] => [...items.filter(isR), ...items.filter((item) => !isR(item))];

function rankList(items: string[]): HTMLElement {
  const cell = element('span', 'senkuro-row-val');
  if (items.length === 0) cell.append(EMPTY);
  items.forEach((item, index) => cell.append(...(index > 0 ? [' '] : []), isR(item) ? element('span', R_HIGHLIGHT, item) : item));
  return cell;
}

function row(label: string, items: string[]): HTMLElement {
  const line = element('div', 'senkuro-popover-row');
  line.append(element('span', 'senkuro-row-label', label), rankList(rFirst(items)));
  return line;
}

function keepInView(popover: HTMLElement): void {
  popover.style.removeProperty(SHIFT_PROPERTY);
  const gutter = Number.parseFloat(getComputedStyle(popover).getPropertyValue(GUTTER_PROPERTY)) || 0;
  const { left, right } = popover.getBoundingClientRect();
  const shift = Math.min(right - (document.documentElement.clientWidth - gutter), left - gutter);
  if (shift > 0) popover.style.setProperty(SHIFT_PROPERTY, `${-shift}px`);
}

function bindOutsideClose(): void {
  if (closingBound) return;
  closingBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Node ? event.target : null;
    document.querySelectorAll(`.${ACTIVE}`).forEach((el) => {
      if (!target || !el.contains(target)) el.classList.remove(ACTIVE);
    });
  });
}

export function removeProfileBadge(): void {
  document.getElementById(WIDGET_ID)?.remove();
}

function renderLoading(widget: HTMLElement, text: string): void {
  widget.classList.add(LOADING);
  widget.classList.remove(FAILED);
  widget.onclick = null;
  widget.onmouseenter = null;
  widget.replaceChildren(element('span', 'senkuro-chip-spinner'), element('span', 'senkuro-f-text', text));
}

function renderError(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  widget.classList.remove(LOADING);
  widget.classList.add(FAILED);
  widget.onmouseenter = null;
  widget.replaceChildren(element('span', 'senkuro-f-text', TEXT.failed));
  widget.onclick = (event) => {
    event.stopPropagation();
    reload(widget, slug, deps, TEXT.retrying);
  };
}

function renderSummary(widget: HTMLElement, slug: string, summary: ProfileValueSummary, deps: ProfileBadgeDeps): void {
  widget.classList.remove(LOADING, FAILED);
  widget.onclick = null;
  widget.onmouseenter = null;

  const popover = element('div', 'senkuro-profile-f-popover');
  const chip = element('div', 'senkuro-f-chip-content');
  chip.append(element('span', 'senkuro-f-value', summary.formattedF), chevronIcon());
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    document.querySelectorAll(`.${ACTIVE}`).forEach((el) => {
      if (el !== widget) el.classList.remove(ACTIVE);
    });
    if (widget.classList.toggle(ACTIVE)) keepInView(popover);
  });

  const title = element('div', 'senkuro-popover-title');
  const caption = element('span', undefined, TEXT.value);
  caption.append(element('strong', 'senkuro-f-accent', summary.formattedF));
  title.append(caption);

  const refresh = element('button', 'senkuro-popover-refresh');
  refresh.type = 'button';
  refresh.title = TEXT.refresh;
  refresh.append(refreshIcon());
  refresh.addEventListener('click', (event) => {
    event.stopPropagation();
    widget.classList.remove(ACTIVE);
    reload(widget, slug, deps, TEXT.refreshing);
  });

  const header = element('div', 'senkuro-popover-header');
  header.append(title, refresh);

  const meta = element('div', 'senkuro-popover-meta', TEXT.total);
  meta.append(element('strong', undefined, String(summary.totalCards)), TEXT.cards);
  if (summary.totalShards > 0) meta.append(TEXT.separator, element('strong', undefined, String(summary.totalShards)), TEXT.shards);

  const body = element('div', 'senkuro-popover-body');
  body.append(row(TEXT.bankRow, [...summary.bank, ...summary.shards]), row(TEXT.cardsRow, [...summary.cards, ...summary.shards]));

  popover.append(header, meta, body);
  widget.onmouseenter = () => keepInView(popover);
  widget.replaceChildren(chip, popover);
}

function reload(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps, text: string): void {
  clearCache(slug);
  delete widget.dataset.valuation;
  renderLoading(widget, text);
  load(slug, deps);
}

const widgetFor = (slug: string): HTMLElement | null => {
  const widget = document.getElementById(WIDGET_ID);
  return widget?.dataset.slug === slug ? widget : null;
};

function load(slug: string, deps: ProfileBadgeDeps): void {
  if (inProgress.has(slug)) return;
  inProgress.add(slug);
  void (async () => {
    try {
      const user = await fetchProfileUser(slug);
      if (!user) {
        const widget = widgetFor(slug);
        if (widget) renderError(widget, slug, deps);
        return;
      }
      const cards = await fetchProfileCards(user.id, (loaded) => {
        const widget = widgetFor(slug);
        if (widget?.classList.contains(LOADING)) renderLoading(widget, progressText(loaded));
      });
      writeCache(slug, cards);
      const widget = widgetFor(slug);
      if (!widget) return;
      renderSummary(widget, slug, calculateProfileValue(cards, deps.db, deps.valuation), deps);
      widget.dataset.valuation = valuationKey(deps.valuation);
    } catch (error) {
      console.error('SenkuTools: failed to fetch profile cards', error);
      const widget = widgetFor(slug);
      if (widget) renderError(widget, slug, deps);
    } finally {
      inProgress.delete(slug);
    }
  })();
}

function show(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  if (widget.classList.contains(FAILED)) return;
  if (inProgress.has(slug)) {
    if (!widget.classList.contains(LOADING)) renderLoading(widget, TEXT.counting);
    return;
  }
  const key = valuationKey(deps.valuation);
  if (widget.dataset.valuation === key) return;
  const cards = readCache(slug);
  if (!cards) {
    renderLoading(widget, TEXT.counting);
    load(slug, deps);
    return;
  }
  renderSummary(widget, slug, calculateProfileValue(cards, deps.db, deps.valuation), deps);
  widget.dataset.valuation = key;
}

export function updateProfileBadge(deps: ProfileBadgeDeps): void {
  const slug = extractProfileSlug(window.location.pathname);
  if (!slug) {
    removeProfileBadge();
    return;
  }
  const target = findNicknameTarget();
  if (!target) return;
  let widget = document.getElementById(WIDGET_ID);
  if (widget && widget.dataset.slug !== slug) {
    widget.remove();
    widget = null;
  }
  if (!widget) {
    widget = element('div', CHIP);
    widget.id = WIDGET_ID;
    widget.dataset.slug = slug;
    bindOutsideClose();
  }
  if (!target.container.contains(widget)) target.insert(widget);
  show(widget, slug, deps);
}
