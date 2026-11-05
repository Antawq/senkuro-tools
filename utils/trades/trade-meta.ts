import { element } from '../shared/dom';
import { scheduleIcon } from '../shared/svg';
import type { Trade } from './trade-capture';

const TIME_CLASS = 'senkutools-trade-time';
const TIME_LABEL_CLASS = 'senkutools-trade-time__label';
const STATUS_EXTRA_CLASS = 'senkutools-trade-status-extra';
const STATUS_SELECTOR = ':scope > .card-trade__status';
const FIRST_LIST_SELECTOR = ':scope > .card-preview-list:first-child .card-list';

export interface TradeConflict {
  targetName: string;
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

  const timeStr = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (isSameDay) return `Сегодня, ${timeStr}`;
  if (isYesterday) return `Вчера, ${timeStr}`;

  const isSameYear = date.getFullYear() === now.getFullYear();
  const dateStr = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(isSameYear ? {} : { year: 'numeric' }),
  });
  return `${dateStr}, ${timeStr}`;
}

export function formatFullTradeDate(iso: string): string {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
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
        return { targetName: other.destination.name };
      }
    }
    if (trade.source.id && other.destination.id === trade.source.id) {
      if (other.request.some((c) => c.slug && offerSlugs.has(c.slug))) {
        return { targetName: other.source.name };
      }
    }
    if (trade.destination.id && other.source.id === trade.destination.id) {
      if (other.offer.some((c) => c.slug && requestSlugs.has(c.slug))) {
        return { targetName: other.destination.name };
      }
    }
    if (trade.destination.id && other.destination.id === trade.destination.id) {
      if (other.request.some((c) => c.slug && requestSlugs.has(c.slug))) {
        return { targetName: other.source.name };
      }
    }
  }
  return null;
}

export function mountTradeMeta(host: HTMLElement, trade: Trade, allTrades: Trade[]): void {
  host.querySelector('.senkutools-trade-reason')?.remove();

  if (trade.createdAt) {
    const firstList = host.querySelector<HTMLElement>(FIRST_LIST_SELECTOR);
    const targetParent = firstList ?? host;
    let timeEl = host.querySelector<HTMLElement>(`.${TIME_CLASS}`);
    if (!timeEl) {
      timeEl = element('div', TIME_CLASS);
      const icon = scheduleIcon(12);
      icon.setAttribute('class', `${TIME_CLASS}__icon`);
      timeEl.append(icon);
      timeEl.append(element('span', TIME_LABEL_CLASS));
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
    const isRejected = trade.status?.toUpperCase() === 'REJECTED' || statusEl.classList.contains('card-trade__status--rejected');
    let extraEl = statusEl.querySelector<HTMLElement>(`.${STATUS_EXTRA_CLASS}`);

    if (!isRejected) {
      extraEl?.remove();
      return;
    }

    const conflict = findTradeConflict(trade, allTrades);
    if (!conflict) {
      extraEl?.remove();
      return;
    }

    const text = conflict.targetName ? ` | карта ушла ${conflict.targetName}` : ' | карта ушла в другой обмен';

    if (!extraEl) {
      extraEl = element('span', STATUS_EXTRA_CLASS);
      statusEl.append(extraEl);
    }
    if (extraEl.textContent !== text) {
      extraEl.textContent = text;
    }
  }
}
