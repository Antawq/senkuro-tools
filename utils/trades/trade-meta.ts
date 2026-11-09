import { element } from '../shared/dom';
import { scheduleIcon } from '../shared/svg';
import type { Trade } from './trade-capture';

const LOCALE = 'ru-RU';
const TIME_CLASS = 'senkutools-trade-time';
const TIME_LABEL_CLASS = `${TIME_CLASS}__label`;
const TIME_ICON_CLASS = `${TIME_CLASS}__icon`;
const TIME_ICON_SIZE_PX = 12;
const STATUS_EXTRA_CLASS = 'senkutools-trade-status-extra';
const STATUS_LINK_CLASS = 'senkutools-trade-status-link';
const STATUS_SELECTOR = ':scope > .card-trade__status';
const FIRST_LIST_SELECTOR = ':scope > .card-preview-list:first-child .card-list';

export interface TradeConflict {
  targetName: string;
  targetSlug?: string | null;
  targetId: string | null;
}

export function userProfilePath(person?: { slug?: string | null; id?: string | null }): string {
  if (person?.slug) return `/users/${person.slug}`;
  const id = person?.id;
  if (!id) return '';
  if (/^\d+$/.test(id)) return `/users/@${id}`;
  try {
    const decoded = atob(id);
    const match = decoded.match(/^(?:USER:)?(\d+)$/);
    if (match?.[1]) return `/users/@${match[1]}`;
  } catch {}
  return `/users/${id}`;
}

export function parseIso(iso: string): Date {
  const normalized = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`;
  return new Date(normalized);
}

export function formatTradeDate(iso: string, now: Date = new Date()): string {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return '';
  const isSameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const isYesterday = date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate();

  const timeStr = date.toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (isSameDay) return `Сегодня, ${timeStr}`;
  if (isYesterday) return `Вчера, ${timeStr}`;

  const isSameYear = date.getFullYear() === now.getFullYear();
  const dateStr = date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(isSameYear ? {} : { year: 'numeric' }),
  });
  return `${dateStr}, ${timeStr}`;
}

export function formatFullTradeDate(iso: string): string {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function findTradeConflict(trade: Trade, allTrades: Trade[]): TradeConflict | null {
  const offerSlugs = new Set(trade.offer.map((c) => c.slug).filter((slug): slug is string => Boolean(slug)));
  const requestSlugs = new Set(trade.request.map((c) => c.slug).filter((slug): slug is string => Boolean(slug)));

  for (const other of allTrades) {
    if (other.id === trade.id) continue;
    if (other.status?.toUpperCase() !== 'ACCEPTED') continue;

    if (trade.source.id && other.source.id === trade.source.id) {
      if (other.offer.some((c) => c.slug && offerSlugs.has(c.slug))) {
        return { targetName: other.destination.name, targetSlug: (other.destination as { slug?: string }).slug ?? null, targetId: other.destination.id };
      }
    }
    if (trade.source.id && other.destination.id === trade.source.id) {
      if (other.request.some((c) => c.slug && offerSlugs.has(c.slug))) {
        return { targetName: other.source.name, targetSlug: (other.source as { slug?: string }).slug ?? null, targetId: other.source.id };
      }
    }
    if (trade.destination.id && other.source.id === trade.destination.id) {
      if (other.offer.some((c) => c.slug && requestSlugs.has(c.slug))) {
        return { targetName: other.destination.name, targetSlug: (other.destination as { slug?: string }).slug ?? null, targetId: other.destination.id };
      }
    }
    if (trade.destination.id && other.destination.id === trade.destination.id) {
      if (other.request.some((c) => c.slug && requestSlugs.has(c.slug))) {
        return { targetName: other.source.name, targetSlug: (other.source as { slug?: string }).slug ?? null, targetId: other.source.id };
      }
    }
  }
  return null;
}

export function mountTradeMeta(host: HTMLElement, trade: Trade, allTrades: Trade[] = [], showRejectReason: boolean = false): void {
  host.querySelector('.senkutools-trade-reason')?.remove();

  if (trade.createdAt) {
    const targetParent = host.querySelector<HTMLElement>(FIRST_LIST_SELECTOR) ?? host;
    let timeEl = host.querySelector<HTMLElement>(`.${TIME_CLASS}`);
    if (!timeEl) {
      timeEl = element('div', TIME_CLASS);
      const icon = scheduleIcon(TIME_ICON_SIZE_PX);
      icon.setAttribute('class', TIME_ICON_CLASS);
      timeEl.append(icon, element('span', TIME_LABEL_CLASS));
      targetParent.append(timeEl);
    } else if (timeEl.parentElement !== targetParent) {
      targetParent.append(timeEl);
    }
    const label = timeEl.querySelector(`.${TIME_LABEL_CLASS}`);
    const timeText = formatTradeDate(trade.createdAt);
    if (label && label.textContent !== timeText) label.textContent = timeText;
    timeEl.title = formatFullTradeDate(trade.createdAt);
  }

  const statusEl = host.querySelector<HTMLElement>(STATUS_SELECTOR);
  if (statusEl) {
    let extraEl = statusEl.querySelector<HTMLElement>(`.${STATUS_EXTRA_CLASS}`);

    if (!showRejectReason) {
      extraEl?.remove();
      return;
    }

    const isRejected = trade.status?.toUpperCase() === 'REJECTED' || statusEl.classList.contains('card-trade__status--rejected');
    if (!isRejected) {
      extraEl?.remove();
      return;
    }

    const conflict = findTradeConflict(trade, allTrades);
    if (!conflict) {
      extraEl?.remove();
      return;
    }

    if (!extraEl) {
      extraEl = element('span', STATUS_EXTRA_CLASS);
      statusEl.append(extraEl);
    }

    const expectedHref = userProfilePath({ slug: conflict.targetSlug, id: conflict.targetId });
    const currentLink = extraEl.querySelector<HTMLAnchorElement>(`.${STATUS_LINK_CLASS}`);
    const currentHref = currentLink?.getAttribute('href') ?? '';
    const currentName = currentLink?.textContent ?? '';

    if (!conflict.targetName) {
      if (extraEl.textContent !== ' (ушла в другой обмен)') {
        extraEl.replaceChildren(document.createTextNode(' (ушла в другой обмен)'));
      }
    } else if (currentHref !== expectedHref || currentName !== conflict.targetName) {
      extraEl.replaceChildren();
      extraEl.append(document.createTextNode(' (ушла к '));
      const link = element('a', STATUS_LINK_CLASS);
      if (expectedHref) link.setAttribute('href', expectedHref);
      link.textContent = conflict.targetName;
      link.addEventListener('click', (event) => event.stopPropagation());
      extraEl.append(link);
      extraEl.append(document.createTextNode(')'));
    }
  }
}
