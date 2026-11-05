import { beforeEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

import type { Trade } from '../utils/trades/trade-capture';
import { detectTradeReason, formatDuration, formatFullTradeDate, formatTradeDate, mountTradeMeta, parseIso } from '../utils/trades/trade-meta';

describe('trade-meta', () => {
  beforeEach(() => {
    const window = new Window();
    (globalThis as unknown as { window: Window }).window = window;
    (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  });

  describe('parseIso', () => {
    it('appends Z when missing', () => {
      const parsed = parseIso('2026-11-05T17:11:58.168480');
      expect(parsed.toISOString()).toBe('2026-11-05T17:11:58.168Z');
    });

    it('keeps existing Z intact', () => {
      const parsed = parseIso('2026-11-05T17:11:58.168Z');
      expect(parsed.toISOString()).toBe('2026-11-05T17:11:58.168Z');
    });
  });

  describe('formatTradeDate', () => {
    it('formats today as Сегодня', () => {
      const now = new Date('2026-11-05T20:00:00.000Z');
      const formatted = formatTradeDate('2026-11-05T17:11:00.000Z', now);
      expect(formatted).toContain('Сегодня');
    });

    it('formats yesterday as Вчера', () => {
      const now = new Date('2026-11-05T20:00:00.000Z');
      const formatted = formatTradeDate('2026-11-04T17:11:00.000Z', now);
      expect(formatted).toContain('Вчера');
    });

    it('formats other date with month', () => {
      const now = new Date('2026-11-05T20:00:00.000Z');
      const formatted = formatTradeDate('2026-10-15T12:00:00.000Z', now);
      expect(formatted).toContain('15 окт.');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds as less than minute', () => {
      expect(formatDuration('2026-11-05T17:11:00.000Z', '2026-11-05T17:11:20.000Z')).toBe('< 1 мин');
    });

    it('formats minutes', () => {
      expect(formatDuration('2026-11-05T17:11:00.000Z', '2026-11-05T17:38:00.000Z')).toBe('27 мин');
    });

    it('formats hours', () => {
      expect(formatDuration('2026-11-05T12:00:00.000Z', '2026-11-05T15:00:00.000Z')).toBe('3 ч');
    });
  });

  describe('detectTradeReason', () => {
    const makeTrade = (overrides: Partial<Trade>): Trade => ({
      kind: 'trade',
      id: 't1',
      source: { id: 'u1', name: 'Author' },
      destination: { id: 'u2', name: 'Recipient' },
      offer: [{ slug: 'card-a', quantity: 1, shard: false }],
      request: [{ slug: 'card-b', quantity: 1, shard: false }],
      ...overrides,
    });

    it('detects auto-cancellation when conflicting trade is accepted', () => {
      const rejected = makeTrade({ id: 't1', status: 'REJECTED' });
      const accepted = makeTrade({
        id: 't2',
        status: 'ACCEPTED',
        destination: { id: 'u3', name: 'Winner' },
      });
      const reason = detectTradeReason(rejected, [rejected, accepted]);
      expect(reason.kind).toBe('auto');
      expect(reason.text).toBe('Авто-отмена: карта отдана Winner');
    });

    it('detects manual rejection when no conflict', () => {
      const rejected = makeTrade({
        id: 't1',
        status: 'REJECTED',
        createdAt: '2026-11-05T17:11:00.000Z',
        updatedAt: '2026-11-05T17:38:00.000Z',
      });
      const reason = detectTradeReason(rejected, [rejected]);
      expect(reason.kind).toBe('manual');
      expect(reason.text).toBe('Отклонён пользователем (27 мин)');
    });

    it('detects accepted status', () => {
      const accepted = makeTrade({
        id: 't1',
        status: 'ACCEPTED',
        createdAt: '2026-11-05T17:11:00.000Z',
        updatedAt: '2026-11-05T17:30:00.000Z',
      });
      const reason = detectTradeReason(accepted, [accepted]);
      expect(reason.kind).toBe('accepted');
      expect(reason.text).toBe('Принят через 19 мин');
    });

    it('returns empty text for pending trades', () => {
      const pending = makeTrade({ id: 't1', status: 'PENDING' });
      const reason = detectTradeReason(pending, [pending]);
      expect(reason.kind).toBe('pending');
      expect(reason.text).toBe('');
    });
  });

  describe('mountTradeMeta', () => {
    it('mounts time badge and reason element into card trade', () => {
      const host = document.createElement('div');
      host.className = 'card-trade';
      const statusEl = document.createElement('div');
      statusEl.className = 'card-trade__status card-trade__status--rejected';
      statusEl.textContent = 'Отклонён';
      host.append(statusEl);

      const trade: Trade = {
        kind: 'trade',
        id: 't1',
        source: { id: 'u1', name: 'Author' },
        destination: { id: 'u2', name: 'Recipient' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-b', quantity: 1, shard: false }],
        status: 'REJECTED',
        createdAt: '2026-11-05T17:11:00.000Z',
      };

      const accepted: Trade = {
        kind: 'trade',
        id: 't2',
        source: { id: 'u1', name: 'Author' },
        destination: { id: 'u3', name: 'LuckyGuy' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-c', quantity: 1, shard: false }],
        status: 'ACCEPTED',
      };

      mountTradeMeta(host, trade, [trade, accepted]);

      const timeEl = host.querySelector('.senkutools-trade-time');
      expect(timeEl).not.toBeNull();
      expect(timeEl?.textContent).toBeTruthy();

      const reasonEl = host.querySelector('.senkutools-trade-reason');
      expect(reasonEl).not.toBeNull();
      expect(reasonEl?.classList.contains('senkutools-trade-reason--auto')).toBe(true);
      expect(reasonEl?.textContent).toBe('Авто-отмена: карта отдана LuckyGuy');
    });
  });
});
