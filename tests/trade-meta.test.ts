import { beforeEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

import type { Trade } from '../utils/trades/trade-capture';
import { findTradeConflict, formatFullTradeDate, formatTradeDate, mountTradeMeta, parseIso } from '../utils/trades/trade-meta';

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

  describe('formatFullTradeDate', () => {
    it('formats full localized date', () => {
      const formatted = formatFullTradeDate('2026-11-05T17:11:00.000Z');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('ноябр');
    });
  });

  describe('findTradeConflict', () => {
    const makeTrade = (overrides: Partial<Trade>): Trade => ({
      kind: 'trade',
      id: 't1',
      source: { id: 'u1', name: 'Author' },
      destination: { id: 'u2', name: 'Recipient' },
      offer: [{ slug: 'card-a', quantity: 1, shard: false }],
      request: [{ slug: 'card-b', quantity: 1, shard: false }],
      ...overrides,
    });

    it('detects conflict when source gave card in another accepted trade', () => {
      const rejected = makeTrade({ id: 't1', status: 'REJECTED' });
      const accepted = makeTrade({
        id: 't2',
        status: 'ACCEPTED',
        destination: { id: 'u3', name: 'Winner' },
      });
      const conflict = findTradeConflict(rejected, [rejected, accepted]);
      expect(conflict).toEqual({ targetName: 'Winner', targetId: 'u3' });
    });

    it('detects conflict when destination gave card in another accepted trade', () => {
      const rejected = makeTrade({
        id: 't1',
        status: 'REJECTED',
        offer: [{ slug: 'card-x', quantity: 1, shard: false }],
        request: [{ slug: 'card-wanted', quantity: 1, shard: false }],
      });
      const accepted = makeTrade({
        id: 't2',
        status: 'ACCEPTED',
        source: { id: 'u2', name: 'Recipient' },
        destination: { id: 'u4', name: 'LuckyBuyer' },
        offer: [{ slug: 'card-wanted', quantity: 1, shard: false }],
        request: [{ slug: 'card-z', quantity: 1, shard: false }],
      });
      const conflict = findTradeConflict(rejected, [rejected, accepted]);
      expect(conflict).toEqual({ targetName: 'LuckyBuyer', targetId: 'u4' });
    });

    it('returns null when no cards overlap', () => {
      const rejected = makeTrade({ id: 't1', status: 'REJECTED' });
      const accepted = makeTrade({
        id: 't2',
        status: 'ACCEPTED',
        offer: [{ slug: 'card-other', quantity: 1, shard: false }],
        request: [{ slug: 'card-different', quantity: 1, shard: false }],
      });
      expect(findTradeConflict(rejected, [rejected, accepted])).toBeNull();
    });

    it('returns null when other trade is not accepted', () => {
      const rejected = makeTrade({ id: 't1', status: 'REJECTED' });
      const pending = makeTrade({
        id: 't2',
        status: 'PENDING',
        destination: { id: 'u3', name: 'Winner' },
      });
      expect(findTradeConflict(rejected, [rejected, pending])).toBeNull();
    });
  });

  describe('mountTradeMeta', () => {
    const createTradeElement = () => {
      const host = document.createElement('div');
      host.className = 'card-trade';

      const previewList = document.createElement('div');
      previewList.className = 'card-preview-list';

      const cardList = document.createElement('div');
      cardList.className = 'card-list';

      const avatar = document.createElement('div');
      avatar.className = 'avatar';

      const cardBody = document.createElement('div');
      cardBody.className = 'card-body';
      cardBody.innerHTML = '<div class="card-name"><span>User</span></div>';

      cardList.append(avatar, cardBody);
      previewList.append(cardList);

      const statusEl = document.createElement('div');
      statusEl.className = 'card-trade__status';
      statusEl.textContent = 'Отклонён';

      host.append(previewList, statusEl);
      return { host, cardList, statusEl };
    };

    it('mounts time badge into card-list when present', () => {
      const { host, cardList } = createTradeElement();
      const trade: Trade = {
        kind: 'trade',
        id: 't1',
        source: { id: 'u1', name: 'Author' },
        destination: { id: 'u2', name: 'Recipient' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-b', quantity: 1, shard: false }],
        status: 'ACCEPTED',
        createdAt: '2026-11-05T17:11:00.000Z',
      };

      mountTradeMeta(host, trade, [trade]);

      const timeEl = cardList.querySelector('.senkutools-trade-time');
      expect(timeEl).not.toBeNull();
      expect(timeEl?.parentElement).toBe(cardList);
    });

    it('does not add reason text to accepted trades', () => {
      const { host, statusEl } = createTradeElement();
      statusEl.className = 'card-trade__status card-trade__status--accepted';
      statusEl.textContent = 'Принят';

      const trade: Trade = {
        kind: 'trade',
        id: 't1',
        source: { id: 'u1', name: 'Author' },
        destination: { id: 'u2', name: 'Recipient' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-b', quantity: 1, shard: false }],
        status: 'ACCEPTED',
      };

      mountTradeMeta(host, trade, [trade]);

      expect(statusEl.textContent).toBe('Принят');
      expect(statusEl.querySelector('.senkutools-trade-status-extra')).toBeNull();
      expect(host.querySelector('.senkutools-trade-reason')).toBeNull();
    });

    it('does not add reason text to rejected trade without conflicts', () => {
      const { host, statusEl } = createTradeElement();
      statusEl.className = 'card-trade__status card-trade__status--rejected';
      statusEl.textContent = 'Отклонён';

      const trade: Trade = {
        kind: 'trade',
        id: 't1',
        source: { id: 'u1', name: 'Author' },
        destination: { id: 'u2', name: 'Recipient' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-b', quantity: 1, shard: false }],
        status: 'REJECTED',
      };

      mountTradeMeta(host, trade, [trade]);

      expect(statusEl.textContent).toBe('Отклонён');
      expect(statusEl.querySelector('.senkutools-trade-status-extra')).toBeNull();
    });

    it('appends auto-cancellation conflict text to rejected status bar', () => {
      const { host, statusEl } = createTradeElement();
      statusEl.className = 'card-trade__status card-trade__status--rejected';
      statusEl.textContent = 'Отклонён';

      const trade: Trade = {
        kind: 'trade',
        id: 't1',
        source: { id: 'u1', name: 'Author' },
        destination: { id: 'u2', name: 'Recipient' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-b', quantity: 1, shard: false }],
        status: 'REJECTED',
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

      const extraEl = statusEl.querySelector('.senkutools-trade-status-extra');
      expect(extraEl).not.toBeNull();
      expect(extraEl?.textContent).toBe(' (ушла к LuckyGuy)');
      expect(statusEl.textContent).toBe('Отклонён (ушла к LuckyGuy)');
      const link = extraEl?.querySelector('a.senkutools-trade-status-link');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('/users/@u3');
      expect(link?.textContent).toBe('LuckyGuy');
    });

    it('renders fallback text when target has no name', () => {
      const { host, statusEl } = createTradeElement();
      statusEl.className = 'card-trade__status card-trade__status--rejected';
      statusEl.textContent = 'Отклонён';

      const trade: Trade = {
        kind: 'trade',
        id: 't1',
        source: { id: 'u1', name: 'Author' },
        destination: { id: 'u2', name: 'Recipient' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-b', quantity: 1, shard: false }],
        status: 'REJECTED',
      };

      const accepted: Trade = {
        kind: 'trade',
        id: 't2',
        source: { id: 'u1', name: 'Author' },
        destination: { id: null, name: '' },
        offer: [{ slug: 'card-a', quantity: 1, shard: false }],
        request: [{ slug: 'card-c', quantity: 1, shard: false }],
        status: 'ACCEPTED',
      };

      mountTradeMeta(host, trade, [trade, accepted]);

      const extraEl = statusEl.querySelector('.senkutools-trade-status-extra');
      expect(extraEl?.textContent).toBe(' (ушла в другой обмен)');
      expect(statusEl.textContent).toBe('Отклонён (ушла в другой обмен)');
    });
  });
});
