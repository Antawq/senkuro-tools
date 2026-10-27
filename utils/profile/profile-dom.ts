import { isAppMounted } from '../shared/app-mounted';
import type { Database } from '../shared/database';
import { element } from '../shared/dom';
import { chevronIcon, refreshIcon } from '../shared/svg';
import { R_RANK, UNKNOWN_LEGEND, UNKNOWN_MARK, type Valuation } from '../shared/trade-value';
import { calculateProfileValue, extractProfileSlug, fetchProfileCards, fetchProfileUser, type ProfileValueSummary } from './profile-cards';
import { forgetCollection, isComplete, readCollection, saveCollection, warnStoreFailure, type Collection } from './profile-store';

export const WIDGET_ID = 'senkuro-profile-card-value';

const CHIP = 'senkuro-profile-f-chip';
const LOADING = 'senkuro-loading';
const FAILED = 'senkuro-error';
const IDLE = 'senkuro-idle';
const ACTIVE = 'senkuro-popover-active';
const R_HIGHLIGHT = 'senkuro-rank-r';
const GUTTER_PROPERTY = '--senkuro-gutter';
const SHIFT_PROPERTY = '--senkuro-popover-shift';
const EMPTY = '-';
const POPOVER_ICON_SIZE_PX = 13;
const FORGET_REASON = 'forgotten';

const TEXT = {
  idle: 'Посчитать ценность',
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
  redraw?: () => void;
}

interface NicknameTarget {
  container: Element;
  insert: (el: HTMLElement) => void;
}

const inProgress = new Map<string, AbortController>();
const known = new Map<string, Collection | null>();
const reading = new Set<string>();

export const isTradeOpen = (): boolean => Boolean(document.querySelector('.modal-content--trade, .modal-trade'));

export function abortProfileLoading(slug?: string, reason?: string): void {
  if (slug) {
    inProgress.get(slug)?.abort(reason);
    inProgress.delete(slug);
  } else {
    for (const controller of inProgress.values()) {
      controller.abort(reason);
    }
    inProgress.clear();
  }
}

export async function forgetProfileBadge(slug: string): Promise<void> {
  abortProfileLoading(slug, FORGET_REASON);
  await forgetCollection(slug);
  known.delete(slug);
}

const valuationKey = ({ commission, valueBySplit, valueBasis, excludeShards }: Valuation): string =>
  JSON.stringify([commission, valueBySplit, valueBasis, excludeShards]);

function remember(slug: string, collection: Collection): void {
  known.set(slug, collection);
  void saveCollection(slug, collection).catch(warnStoreFailure);
}

function readStored(slug: string, deps: ProfileBadgeDeps): void {
  if (reading.has(slug)) return;
  reading.add(slug);
  void readCollection(slug)
    .catch(warnStoreFailure)
    .then((collection) => {
      reading.delete(slug);
      if (!known.has(slug)) known.set(slug, collection);
      deps.redraw?.();
    });
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

const isR = (item: string): boolean => item.endsWith(R_RANK);

const isUnknown = (item: string): boolean => item.endsWith(UNKNOWN_MARK);

function rankItem(item: string): HTMLElement | string {
  if (isR(item)) return element('span', R_HIGHLIGHT, item);
  if (!isUnknown(item)) return item;
  const unknownElement = element('span', undefined, item);
  unknownElement.title = UNKNOWN_LEGEND;
  return unknownElement;
}

const rFirst = (items: string[]): string[] => [...items.filter(isR), ...items.filter((item) => !isR(item))];

function rankList(items: string[]): HTMLElement {
  const cell = element('span', 'senkuro-row-val');
  if (items.length === 0) cell.append(EMPTY);
  items.forEach((item, index) => cell.append(...(index > 0 ? [' '] : []), rankItem(item)));
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

export function handleOutsideClick(event: Event): void {
  const target = event.target instanceof Node ? event.target : null;
  document.querySelectorAll(`.${ACTIVE}`).forEach((el) => {
    if (!target || !el.contains(target)) el.classList.remove(ACTIVE);
  });
}

export function removeProfileBadge(): void {
  document.getElementById(WIDGET_ID)?.remove();
  known.clear();
}

export const profileBadgeMissing = (): boolean =>
  !isTradeOpen() && isAppMounted(document) && Boolean(extractProfileSlug(window.location.pathname) && !document.getElementById(WIDGET_ID));

function renderLoading(widget: HTMLElement, text: string): void {
  widget.classList.add(LOADING);
  widget.classList.remove(FAILED, IDLE);
  widget.onclick = null;
  widget.onmouseenter = null;
  const content = element('div', 'senkuro-f-chip-content');
  content.append(element('span', 'senkuro-chip-spinner'), element('span', 'senkuro-f-text', text));
  widget.replaceChildren(content);
}

function renderIdle(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  widget.classList.remove(LOADING, FAILED);
  widget.classList.add(IDLE);
  widget.onmouseenter = null;
  widget.replaceChildren(element('span', 'senkuro-f-text', TEXT.idle));
  widget.onclick = (event) => {
    event.stopPropagation();
    renderLoading(widget, TEXT.counting);
    load(slug, deps);
  };
}

function renderError(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  widget.classList.remove(LOADING, IDLE);
  widget.classList.add(FAILED);
  widget.onmouseenter = null;
  widget.replaceChildren(element('span', 'senkuro-f-text', TEXT.failed));
  widget.onclick = (event) => {
    event.stopPropagation();
    reload(widget, slug, deps, false);
  };
}

function renderSummary(widget: HTMLElement, slug: string, summary: ProfileValueSummary, deps: ProfileBadgeDeps): void {
  widget.classList.remove(LOADING, FAILED, IDLE);
  widget.onclick = null;
  widget.onmouseenter = null;

  const popover = element('div', 'senkuro-profile-f-popover');
  const chip = element('div', 'senkuro-f-chip-content');
  chip.append(element('span', 'senkuro-f-value', summary.formattedF), chevronIcon('senkuro-chip-arrow'));
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
  refresh.append(refreshIcon(POPOVER_ICON_SIZE_PX));
  refresh.addEventListener('click', (event) => {
    event.stopPropagation();
    widget.classList.remove(ACTIVE);
    reload(widget, slug, deps, true);
  });

  const header = element('div', 'senkuro-popover-header');
  header.append(title, refresh);

  const meta = element('div', 'senkuro-popover-meta', TEXT.total);
  meta.append(element('strong', undefined, String(summary.totalCards)), TEXT.cards);
  if (summary.totalShards > 0) meta.append(TEXT.separator, element('strong', undefined, String(summary.totalShards)), TEXT.shards);

  const body = element('div', 'senkuro-popover-body');
  body.append(row(TEXT.bankRow, [...summary.bank, ...summary.shardBank]), row(TEXT.cardsRow, [...summary.cards, ...summary.shards]));

  popover.append(header, meta, body);
  widget.onmouseenter = () => keepInView(popover);
  widget.replaceChildren(chip, popover);
  if (widget.matches(':hover') || widget.classList.contains(ACTIVE)) keepInView(popover);
}

function reload(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps, fresh: boolean): void {
  delete widget.dataset.valuation;
  renderLoading(widget, fresh ? TEXT.refreshing : TEXT.retrying);
  load(slug, deps, fresh);
}

const widgetFor = (slug: string): HTMLElement | null => {
  const widget = document.getElementById(WIDGET_ID);
  return widget?.dataset.slug === slug ? widget : null;
};

async function download(slug: string, signal: AbortSignal, fresh: boolean, onPage: (latest: Collection) => void): Promise<Collection | null> {
  const stored = fresh ? null : ((await readCollection(slug).catch(warnStoreFailure)) ?? known.get(slug) ?? null);
  if (stored && isComplete(stored)) {
    known.set(slug, stored);
    return stored;
  }
  const userId = stored?.userId ?? (await fetchProfileUser(slug, undefined, signal))?.id;
  if (!userId) return null;
  const started: Collection = stored ?? { at: Date.now(), userId, cards: [], after: null, pages: 0 };
  let latest = started;
  await fetchProfileCards(userId, {
    from: started,
    signal,
    onPage: (page) => {
      latest = { ...started, ...page };
      onPage(latest);
      const widget = widgetFor(slug);
      if (widget?.classList.contains(LOADING)) renderLoading(widget, progressText(page.cards.length));
    },
  });
  remember(slug, latest);
  return latest;
}

function load(slug: string, deps: ProfileBadgeDeps, fresh = false): void {
  if (inProgress.has(slug) || isTradeOpen()) return;
  const controller = new AbortController();
  inProgress.set(slug, controller);
  const progress: { latest?: Collection } = {};

  void (async () => {
    try {
      const collection = await download(slug, controller.signal, fresh, (latest) => {
        progress.latest = latest;
      });
      const widget = widgetFor(slug);
      if (!widget) return;
      if (!collection) {
        renderError(widget, slug, deps);
        return;
      }
      renderSummary(widget, slug, calculateProfileValue(collection.cards, deps.db, deps.valuation), deps);
      widget.dataset.valuation = valuationKey(deps.valuation);
    } catch (error) {
      if (progress.latest && controller.signal.reason !== FORGET_REASON) remember(slug, progress.latest);
      if (controller.signal.aborted) return;
      console.error('SenkuTools: failed to fetch profile cards', error);
      const widget = widgetFor(slug);
      if (widget) renderError(widget, slug, deps);
    } finally {
      if (inProgress.get(slug) === controller) {
        inProgress.delete(slug);
      }
    }
  })();
}

function show(widget: HTMLElement, slug: string, deps: ProfileBadgeDeps): void {
  if (widget.classList.contains(FAILED) || isTradeOpen()) return;
  if (inProgress.has(slug)) {
    if (!widget.classList.contains(LOADING)) renderLoading(widget, TEXT.counting);
    return;
  }
  const collection = known.get(slug);
  if (!collection || !isComplete(collection)) {
    if (!widget.classList.contains(IDLE)) renderIdle(widget, slug, deps);
    return;
  }
  const key = valuationKey(deps.valuation);
  if (widget.dataset.valuation === key) return;
  renderSummary(widget, slug, calculateProfileValue(collection.cards, deps.db, deps.valuation), deps);
  widget.dataset.valuation = key;
}

function pauseCount(deps: ProfileBadgeDeps): void {
  abortProfileLoading();
  const widget = document.getElementById(WIDGET_ID);
  if (widget?.dataset.slug && widget.classList.contains(LOADING)) renderIdle(widget, widget.dataset.slug, deps);
}

export function updateProfileBadge(deps: ProfileBadgeDeps): void {
  if (isTradeOpen()) {
    pauseCount(deps);
    return;
  }
  const slug = extractProfileSlug(window.location.pathname);
  if (!slug) {
    removeProfileBadge();
    return;
  }
  const target = findNicknameTarget();
  if (!target) return;
  if (!known.has(slug)) {
    readStored(slug, deps);
    return;
  }
  if (!isAppMounted(document)) return;
  let widget = document.getElementById(WIDGET_ID);
  if (widget && widget.dataset.slug !== slug) {
    widget.remove();
    widget = null;
  }
  if (!widget) {
    widget = element('div', CHIP);
    widget.id = WIDGET_ID;
    widget.dataset.slug = slug;
  }
  if (!target.container.contains(widget)) target.insert(widget);
  show(widget, slug, deps);
}
