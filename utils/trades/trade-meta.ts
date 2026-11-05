import { element } from '../shared/dom';
import { closeIcon, doneIcon, scheduleIcon, swapHorizontalIcon } from '../shared/svg';
import type { Trade } from './trade-capture';

const TIME_CLASS = 'senkutools-trade-time';
const TIME_LABEL_CLASS = 'senkutools-trade-time__label';
const REASON_CLASS = 'senkutools-trade-reason';
const REASON_TEXT_CLASS = 'senkutools-trade-reason__text';
const STATUS_SELECTOR = ':scope > .card-trade__status';

const MS_SECOND = 1000;
const MS_MINUTE = 60 * MS_SECOND;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

export interface TradeReason {
  kind: 'auto' | 'manual' | 'accepted' | 'pending';
  text: string;
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

export function formatDuration(startIso: string, endIso: string): string {
  const start = parseIso(startIso).getTime();
  const end = parseIso(endIso).getTime();
  const diff = Math.max(0, end - start);
  if (diff < MS_MINUTE) return '< 1 мин';
  if (diff < MS_HOUR) return `${Math.round(diff / MS_MINUTE)} мин`;
  if (diff < MS_DAY) return `${Math.round(diff / MS_HOUR)} ч`;
  return `${Math.round(diff / MS_DAY)} дн`;
}

export function detectTradeReason(trade: Trade, allTrades: Trade[], domStatus?: string): TradeReason {
  const status = (trade.status || domStatus || '').toUpperCase();
  if (status === 'ACCEPTED') {
    const duration = trade.createdAt && trade.updatedAt ? formatDuration(trade.createdAt, trade.updatedAt) : '';
    return {
      kind: 'accepted',
      text: duration ? `Принят через ${duration}` : 'Принят',
    };
  }
  if (status === 'PENDING') {
    return { kind: 'pending', text: '' };
  }
  if (status === 'REJECTED') {
    const offerSlugs = new Set(trade.offer.map((c) => c.slug).filter((slug): slug is string => Boolean(slug)));
    const conflicting = allTrades.find(
      (other) =>
        other.id !== trade.id &&
        other.status?.toUpperCase() === 'ACCEPTED' &&
        other.source.id === trade.source.id &&
        other.offer.some((c) => c.slug && offerSlugs.has(c.slug))
    );
    if (conflicting) {
      const targetName = conflicting.destination.name;
      return {
        kind: 'auto',
        text: targetName ? `Авто-отмена: карта отдана ${targetName}` : 'Авто-отмена: карта ушла в другой обмен',
      };
    }
    const duration = trade.createdAt && trade.updatedAt ? formatDuration(trade.createdAt, trade.updatedAt) : '';
    return {
      kind: 'manual',
      text: duration ? `Отклонён пользователем (${duration})` : 'Отклонён пользователем',
    };
  }
  return { kind: 'pending', text: '' };
}

function iconForReason(kind: TradeReason['kind']): SVGSVGElement {
  if (kind === 'auto') return swapHorizontalIcon(14);
  if (kind === 'accepted') return doneIcon(14);
  return closeIcon(14);
}

export function mountTradeMeta(host: HTMLElement, trade: Trade, allTrades: Trade[]): void {
  if (trade.createdAt) {
    let timeEl = host.querySelector<HTMLElement>(`:scope > .${TIME_CLASS}`);
    if (!timeEl) {
      timeEl = element('div', TIME_CLASS);
      const icon = scheduleIcon(12);
      icon.setAttribute('class', `${TIME_CLASS}__icon`);
      timeEl.append(icon);
      timeEl.append(element('span', TIME_LABEL_CLASS));
      host.append(timeEl);
    }
    const label = timeEl.querySelector(`.${TIME_LABEL_CLASS}`);
    const timeText = formatTradeDate(trade.createdAt);
    if (label && label.textContent !== timeText) label.textContent = timeText;
    timeEl.title = formatFullTradeDate(trade.createdAt);
  }

  const statusEl = host.querySelector<HTMLElement>(STATUS_SELECTOR);
  if (statusEl) {
    const domStatus = statusEl.classList.contains('card-trade__status--rejected')
      ? 'REJECTED'
      : statusEl.classList.contains('card-trade__status--accepted')
        ? 'ACCEPTED'
        : 'PENDING';
    const reason = detectTradeReason(trade, allTrades, domStatus);
    let reasonEl = host.querySelector<HTMLElement>(`:scope > .${REASON_CLASS}`);
    if (!reason.text) {
      reasonEl?.remove();
      return;
    }
    if (!reasonEl) {
      reasonEl = element('div', `${REASON_CLASS} ${REASON_CLASS}--${reason.kind}`);
      const icon = iconForReason(reason.kind);
      icon.setAttribute('class', `${REASON_CLASS}__icon`);
      reasonEl.append(icon);
      reasonEl.append(element('span', REASON_TEXT_CLASS));
      statusEl.after(reasonEl);
    }
    const expectedClass = `${REASON_CLASS} ${REASON_CLASS}--${reason.kind}`;
    if (reasonEl.className !== expectedClass) {
      reasonEl.className = expectedClass;
      const oldIcon = reasonEl.querySelector(`.${REASON_CLASS}__icon`);
      const newIcon = iconForReason(reason.kind);
      newIcon.setAttribute('class', `${REASON_CLASS}__icon`);
      if (oldIcon) oldIcon.replaceWith(newIcon);
    }
    const textEl = reasonEl.querySelector(`.${REASON_TEXT_CLASS}`);
    if (textEl && textEl.textContent !== reason.text) textEl.textContent = reason.text;
  }
}
