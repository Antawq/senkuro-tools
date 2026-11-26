import { element } from '../shared/dom';
import { scheduleIcon } from '../shared/svg';
import type { Trade } from './trade-capture';

const LOCALE = 'ru-RU';
const CREATED_WORD = 'создан';
const TIME_CLASS = 'senkutools-trade-time';
const TIME_LABEL_CLASS = `${TIME_CLASS}__label`;
const TIME_ICON_CLASS = `${TIME_CLASS}__icon`;
const TIME_ICON_SIZE_PX = 12;
const STATUS_EXTRA_CLASS = 'senkutools-trade-status-extra';
const STATUS_LINK_CLASS = 'senkutools-trade-status-link';
const STATUS_SELECTOR = ':scope > .card-trade__status';

export interface TradeConflict {
  targetName: string;
  targetSlug?: string | null;
  targetId: string | null;
}

function findUserNumber(id: string): string | null {
  try {
    return atob(id).match(/^(?:USER:)?(\d+)$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function userProfilePath(person?: { slug?: string | null; id?: string | null }): string {
  if (person?.slug) return `/users/${person.slug}`;
  const id = person?.id;
  if (!id) return '';
  if (/^\d+$/.test(id)) return `/users/@${id}`;
  const userNumber = findUserNumber(id);
  return userNumber ? `/users/@${userNumber}` : `/users/${id}`;
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

  const timeOfDay = date.toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (isSameDay) return `сегодня, ${timeOfDay}`;
  if (isYesterday) return `вчера, ${timeOfDay}`;

  const isSameYear = date.getFullYear() === now.getFullYear();
  const shortDate = date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(isSameYear ? {} : { year: 'numeric' }),
  });
  return `${shortDate}, ${timeOfDay}`;
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
  const offerSlugs = new Set(trade.offer.map((card) => card.slug).filter((slug): slug is string => Boolean(slug)));
  const requestSlugs = new Set(trade.request.map((card) => card.slug).filter((slug): slug is string => Boolean(slug)));

  for (const other of allTrades) {
    if (other.id === trade.id) continue;
    if (other.status?.toUpperCase() !== 'ACCEPTED') continue;

    if (trade.source.id && other.source.id === trade.source.id) {
      if (other.offer.some((card) => card.slug && offerSlugs.has(card.slug))) {
        return { targetName: other.destination.name, targetSlug: (other.destination as { slug?: string }).slug ?? null, targetId: other.destination.id };
      }
    }
    if (trade.source.id && other.destination.id === trade.source.id) {
      if (other.request.some((card) => card.slug && offerSlugs.has(card.slug))) {
        return { targetName: other.source.name, targetSlug: (other.source as { slug?: string }).slug ?? null, targetId: other.source.id };
      }
    }
    if (trade.destination.id && other.source.id === trade.destination.id) {
      if (other.offer.some((card) => card.slug && requestSlugs.has(card.slug))) {
        return { targetName: other.destination.name, targetSlug: (other.destination as { slug?: string }).slug ?? null, targetId: other.destination.id };
      }
    }
    if (trade.destination.id && other.destination.id === trade.destination.id) {
      if (other.request.some((card) => card.slug && requestSlugs.has(card.slug))) {
        return { targetName: other.source.name, targetSlug: (other.source as { slug?: string }).slug ?? null, targetId: other.source.id };
      }
    }
  }
  return null;
}

function mountTradeTime(host: HTMLElement, statusElement: HTMLElement | null, createdAt: string): void {
  const createdText = formatTradeDate(createdAt);
  let timeElement = host.querySelector<HTMLElement>(`.${TIME_CLASS}`);
  if (!statusElement || !createdText) {
    timeElement?.remove();
    return;
  }
  if (!timeElement) {
    timeElement = element('div', TIME_CLASS);
    const icon = scheduleIcon(TIME_ICON_SIZE_PX);
    icon.setAttribute('class', TIME_ICON_CLASS);
    timeElement.append(icon, element('span', TIME_LABEL_CLASS));
  }
  if (timeElement.parentElement !== statusElement) statusElement.append(timeElement);
  const label = timeElement.querySelector(`.${TIME_LABEL_CLASS}`);
  const timeText = `${CREATED_WORD} ${createdText}`;
  if (label && label.textContent !== timeText) label.textContent = timeText;
  timeElement.title = formatFullTradeDate(createdAt);
}

export function mountTradeMeta(host: HTMLElement, trade: Trade, allTrades: Trade[] = [], showRejectReason: boolean = false): void {
  host.querySelector('.senkutools-trade-reason')?.remove();

  const statusElement = host.querySelector<HTMLElement>(STATUS_SELECTOR);
  mountTradeTime(host, statusElement, trade.createdAt ?? '');

  if (statusElement) {
    let extraElement = statusElement.querySelector<HTMLElement>(`.${STATUS_EXTRA_CLASS}`);

    if (!showRejectReason) {
      extraElement?.remove();
      return;
    }

    const isRejected = trade.status?.toUpperCase() === 'REJECTED' || statusElement.classList.contains('card-trade__status--rejected');
    if (!isRejected) {
      extraElement?.remove();
      return;
    }

    const conflict = findTradeConflict(trade, allTrades);
    if (!conflict) {
      extraElement?.remove();
      return;
    }

    if (!extraElement) {
      extraElement = element('span', STATUS_EXTRA_CLASS);
      statusElement.insertBefore(extraElement, statusElement.querySelector(`:scope > .${TIME_CLASS}`));
    }

    const expectedHref = userProfilePath({ slug: conflict.targetSlug, id: conflict.targetId });
    const currentLink = extraElement.querySelector<HTMLAnchorElement>(`.${STATUS_LINK_CLASS}`);
    const currentHref = currentLink?.getAttribute('href') ?? '';
    const currentName = currentLink?.textContent ?? '';

    if (!conflict.targetName) {
      if (extraElement.textContent !== ' (ушла в другой обмен)') {
        extraElement.replaceChildren(document.createTextNode(' (ушла в другой обмен)'));
      }
    } else if (currentHref !== expectedHref || currentName !== conflict.targetName) {
      extraElement.replaceChildren();
      extraElement.append(document.createTextNode(' (ушла к '));
      const link = element('a', STATUS_LINK_CLASS);
      if (expectedHref) link.setAttribute('href', expectedHref);
      link.textContent = conflict.targetName;
      link.addEventListener('click', (event) => event.stopPropagation());
      extraElement.append(link);
      extraElement.append(document.createTextNode(')'));
    }
  }
}
