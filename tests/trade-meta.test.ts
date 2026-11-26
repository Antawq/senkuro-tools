import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Person, Trade } from '../utils/trades/trade-capture';
import { findTradeConflict, formatFullTradeDate, formatTradeDate, mountTradeMeta, parseIso, userProfilePath } from '../utils/trades/trade-meta';

const NOVEMBER = 10;
const OCTOBER = 9;
const localIso = (year: number, month: number, day: number, hour: number, minute: number): string => new Date(year, month, day, hour, minute).toISOString();

const tradeAt = (createdAt?: string): Trade => ({
  kind: 'trade',
  id: 't1',
  source: { id: 'u1', name: 'Author' },
  destination: { id: 'u2', name: 'Recipient' },
  offer: [{ slug: 'card-a', quantity: 1, shard: false }],
  request: [{ slug: 'card-b', quantity: 1, shard: false }],
  ...(createdAt ? { createdAt } : {}),
});

const tradeElement = (withStatus = true) => {
  const host = document.createElement('div');
  host.className = 'card-trade';
  const previewList = document.createElement('div');
  previewList.className = 'card-preview-list';
  previewList.innerHTML = '<div class="card-preview-list__top"><div class="card-list"></div></div>';
  host.append(previewList);
  const statusEl = document.createElement('div');
  statusEl.className = 'card-trade__status card-trade__status--pending';
  statusEl.textContent = 'Ожидает';
  if (withStatus) host.append(statusEl);
  document.body.append(host);
  return { host, statusEl };
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe('parseIso', () => {
  it('reads a time without a zone as UTC', () => {
    expect(parseIso('2026-11-05T17:11:58.168480').toISOString()).toBe('2026-11-05T17:11:58.168Z');
  });

  it('keeps a time that carries its zone', () => {
    expect(parseIso('2026-11-05T17:11:58.168Z').toISOString()).toBe('2026-11-05T17:11:58.168Z');
    expect(parseIso('2026-11-05T22:11:58+05:00').toISOString()).toBe('2026-11-05T17:11:58.000Z');
  });
});

describe('formatTradeDate', () => {
  const now = new Date(2026, NOVEMBER, 5, 20, 0);

  it('says today with the time of the trade', () => {
    expect(formatTradeDate(localIso(2026, NOVEMBER, 5, 17, 11), now)).toBe('сегодня, 17:11');
  });

  it('says yesterday with the time of the trade', () => {
    expect(formatTradeDate(localIso(2026, NOVEMBER, 4, 17, 11), now)).toBe('вчера, 17:11');
  });

  it('gives the day and the short month within the year', () => {
    expect(formatTradeDate(localIso(2026, OCTOBER, 15, 12, 0), now)).toBe('15 окт., 12:00');
  });

  it('adds the year for an earlier year', () => {
    expect(formatTradeDate(localIso(2025, OCTOBER, 15, 12, 0), now)).toContain('2025');
  });

  it('gives nothing for a time it cannot read', () => {
    expect(formatTradeDate('not a time', now)).toBe('');
  });
});

describe('formatFullTradeDate', () => {
  it('spells the day, the month, the year and the seconds', () => {
    const text = formatFullTradeDate(new Date(2026, NOVEMBER, 5, 17, 11, 9).toISOString());
    expect(text).toContain('5 ноября 2026');
    expect(text).toContain('17:11:09');
  });

  it('gives nothing for a time it cannot read', () => {
    expect(formatFullTradeDate('not a time')).toBe('');
  });
});

describe('userProfilePath', () => {
  it('uses slug when available', () => {
    expect(userProfilePath({ slug: 'siberianqqq', id: 'VVNFUjoxNzY4MjE2MzU5OTM1ODUxODA' })).toBe('/users/siberianqqq');
  });

  it('decodes Relay global ID to numeric user id', () => {
    expect(userProfilePath({ id: 'VVNFUjoxNzY4MjE2MzU5OTM1ODUxODA' })).toBe('/users/@176821635993585180');
  });

  it('uses numeric id directly when already numeric', () => {
    expect(userProfilePath({ id: '176821635993585180' })).toBe('/users/@176821635993585180');
  });

  it('returns empty string when no person is given', () => {
    expect(userProfilePath(undefined)).toBe('');
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
    expect(conflict).toEqual({ targetName: 'Winner', targetSlug: null, targetId: 'u3' });
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
    expect(conflict).toEqual({ targetName: 'LuckyBuyer', targetSlug: null, targetId: 'u4' });
  });

  it('detects conflict with targetSlug when present', () => {
    const rejected = makeTrade({ id: 't1', status: 'REJECTED' });
    const accepted = makeTrade({
      id: 't2',
      status: 'ACCEPTED',
      destination: { id: 'u3', slug: 'siberianqqq', name: 'Winner' } as Person,
    });
    const conflict = findTradeConflict(rejected, [rejected, accepted]);
    expect(conflict).toEqual({ targetName: 'Winner', targetSlug: 'siberianqqq', targetId: 'u3' });
  });

  it('returns null when no cards overlap', () => {
    const rejected = makeTrade({ id: 't1', status: 'REJECTED' });
    const accepted = makeTrade({
      id: 't2',
      status: 'ACCEPTED',
      offer: [{ slug: 'other-card', quantity: 1, shard: false }],
      request: [{ slug: 'other-card-2', quantity: 1, shard: false }],
    });
    expect(findTradeConflict(rejected, [rejected, accepted])).toBeNull();
  });
});

describe('mountTradeMeta', () => {
  const createdAt = localIso(2026, OCTOBER, 15, 12, 0);

  it('puts the time into the status stripe after the status, with the full date as its title', () => {
    const { host, statusEl } = tradeElement();
    mountTradeMeta(host, tradeAt(createdAt));
    const time = statusEl.querySelector<HTMLElement>('.senkutools-trade-time');
    expect(time?.parentElement).toBe(statusEl);
    expect(statusEl.firstChild?.textContent).toBe('Ожидает');
    expect(time?.querySelector('.senkutools-trade-time__label')?.textContent).toBe(`создан ${formatTradeDate(createdAt)}`);
    expect(time?.title).toBe(formatFullTradeDate(createdAt));
    expect(time?.querySelector('svg')).not.toBeNull();
    expect(host.querySelector('.card-preview-list .senkutools-trade-time')).toBeNull();
  });

  it('says the time is when the trade was created, in lower case after the status', () => {
    const { host } = tradeElement();
    mountTradeMeta(host, tradeAt(new Date().toISOString()));
    expect(host.querySelector('.senkutools-trade-time__label')?.textContent).toMatch(/^создан сегодня, \d{2}:\d{2}$/);
  });

  it('adds no time to a trade without a status stripe', () => {
    const { host } = tradeElement(false);
    mountTradeMeta(host, tradeAt(createdAt));
    expect(host.querySelector('.senkutools-trade-time')).toBeNull();
  });

  it('adds no time when the trade time cannot be read', () => {
    const { host } = tradeElement();
    mountTradeMeta(host, tradeAt('not a time'));
    expect(host.querySelector('.senkutools-trade-time')).toBeNull();
  });

  it('keeps one time when it is mounted again and puts it into a status stripe that appeared later', () => {
    const { host, statusEl } = tradeElement(false);
    mountTradeMeta(host, tradeAt(createdAt));
    host.append(statusEl);
    mountTradeMeta(host, tradeAt(createdAt));
    expect(host.querySelectorAll('.senkutools-trade-time')).toHaveLength(1);
    expect(host.querySelector('.senkutools-trade-time')?.parentElement).toBe(statusEl);
  });

  it('puts the time back after the site rewrites the status text', () => {
    const { host, statusEl } = tradeElement();
    mountTradeMeta(host, tradeAt(createdAt));
    statusEl.textContent = 'Принят';
    mountTradeMeta(host, tradeAt(createdAt));
    expect(statusEl.firstChild?.textContent).toBe('Принят');
    expect(statusEl.querySelectorAll(':scope > .senkutools-trade-time')).toHaveLength(1);
  });

  it('puts the conflict reason between the status and the time', () => {
    const { host, statusEl } = tradeElement();
    statusEl.className = 'card-trade__status card-trade__status--rejected';
    statusEl.textContent = 'Отклонён';
    const rejected: Trade = { ...tradeAt(createdAt), status: 'REJECTED' };
    const accepted: Trade = {
      ...tradeAt(createdAt),
      id: 't2',
      destination: { id: 'u3', name: 'LuckyGuy' },
      request: [{ slug: 'card-c', quantity: 1, shard: false }],
      status: 'ACCEPTED',
    };
    mountTradeMeta(host, rejected, [rejected, accepted], true);
    expect([...statusEl.children].map((child) => child.className)).toEqual(['senkutools-trade-status-extra', 'senkutools-trade-time']);
  });

  it('rewrites the label when the time changes', () => {
    const { host } = tradeElement();
    mountTradeMeta(host, tradeAt(createdAt));
    mountTradeMeta(host, tradeAt(localIso(2025, OCTOBER, 15, 12, 0)));
    expect(host.querySelector('.senkutools-trade-time__label')?.textContent).toContain('2025');
  });

  it('adds nothing for a trade that carries no time', () => {
    const { host } = tradeElement();
    mountTradeMeta(host, tradeAt());
    expect(host.querySelector('.senkutools-trade-time')).toBeNull();
  });

  it('mounts conflict reason with link when reject reason is enabled and trade is rejected', () => {
    const { host, statusEl } = tradeElement();
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
      destination: { id: '176821635993585180', name: 'LuckyGuy' },
      offer: [{ slug: 'card-a', quantity: 1, shard: false }],
      request: [{ slug: 'card-c', quantity: 1, shard: false }],
      status: 'ACCEPTED',
    };

    mountTradeMeta(host, trade, [trade, accepted], true);

    const extraEl = statusEl.querySelector('.senkutools-trade-status-extra');
    expect(extraEl).not.toBeNull();
    expect(extraEl?.textContent).toBe(' (ушла к LuckyGuy)');
    expect(statusEl.textContent).toBe('Отклонён (ушла к LuckyGuy)');
    const link = extraEl?.querySelector('a.senkutools-trade-status-link');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/users/@176821635993585180');
    expect(link?.textContent).toBe('LuckyGuy');
  });

  it('does not mount rejection conflict reason when disabled by default', () => {
    const { host, statusEl } = tradeElement();
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
    expect(statusEl.querySelector('.senkutools-trade-status-extra')).toBeNull();
    expect(statusEl.textContent).toBe('Отклонён');
  });
});

describe('trade time stylesheet', () => {
  it('draws the time in the colour of the status text, with no extra fading that would drop its contrast on the stripe', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/trade-meta.css'), 'utf8'));
    const time = [...sheet.cssRules].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.senkutools-trade-time');
    expect(time?.style.getPropertyValue('color')).toBe('inherit');
    expect(time?.style.getPropertyValue('opacity')).toBe('');
  });
});
