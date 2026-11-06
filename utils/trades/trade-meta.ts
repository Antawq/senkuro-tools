import { element } from '../shared/dom';
import { scheduleIcon } from '../shared/svg';
import type { Trade } from './trade-capture';

const LOCALE = 'ru-RU';
const TIME_CLASS = 'senkutools-trade-time';
const TIME_LABEL_CLASS = `${TIME_CLASS}__label`;
const TIME_ICON_CLASS = `${TIME_CLASS}__icon`;
const TIME_ICON_SIZE_PX = 12;
const FIRST_LIST_SELECTOR = ':scope > .card-preview-list:first-child .card-list';

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

export function mountTradeMeta(host: HTMLElement, trade: Trade): void {
  if (!trade.createdAt) return;
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
