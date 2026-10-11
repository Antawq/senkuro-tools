import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountCard } from '../utils/account-cards';
import { ago, formatCoins, formatCount, messageFor, mountAccountPanel, type PanelDeps } from '../utils/account-panel';
import { ApiError } from '../utils/graphql';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../entrypoints/popup/index.html'), 'utf8');
const markup = (/<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const NOW = 1_700_000_000_000;

const db = {
  's-card': { price: 1.25, name: 'S', rank: 'S' },
  'a-card': { price: 1.5, name: 'A', rank: 'A' },
  'f-card': { price: 1.25, name: 'F', rank: 'F' },
  'r-card': { price: 1.25, name: 'R', rank: 'R' },
};

const own = (slug: string, quantity = 1, shard = false): AccountCard => ({ slug, quantity, shard });
const inventory = [own('s-card', 2), own('a-card'), own('f-card', 10), own('missing', 3), own('s-card', 4, true)];

const depsOf = (overrides: Partial<PanelDeps> = {}) => ({
  readToken: vi.fn(async () => 'token' as string | null),
  fetchCards: vi.fn(async (_token: string, _onProgress: (loaded: number) => void) => inventory),
  loadDatabase: vi.fn(async () => db),
  loadSnapshot: vi.fn(async () => null as { at: number; cards: AccountCard[] } | null),
  saveSnapshot: vi.fn(async (_cards: AccountCard[], _at: number) => undefined),
  clearSnapshot: vi.fn(async () => undefined),
  commission: () => true,
  now: () => NOW,
  ...overrides,
});

const el = (id: string) => document.getElementById(id) as HTMLElement;
const text = (id: string) => el(id).textContent;
const button = (id: string) => el(id) as HTMLButtonElement;
const flush = () => new Promise((resolveNext) => setTimeout(resolveNext, 0));
const press = async (id: string) => {
  el(id).click();
  await flush();
};

beforeEach(() => {
  document.body.innerHTML = markup;
});

describe('account panel', () => {
  it('asks for a button press before it reads anything', async () => {
    const deps = depsOf();
    const panel = mountAccountPanel(document, deps);
    await panel.ready;
    expect(el('accountStats').hidden).toBe(true);
    expect(button('accountLoad').textContent).toBe('Показать');
    expect(el('accountClear').hidden).toBe(true);
    expect(text('accountHint')).toContain('api.senkuro.com');
    expect(text('accountHint')).toContain('только по нажатию кнопки');
    expect(deps.readToken).not.toHaveBeenCalled();
    expect(deps.fetchCards).not.toHaveBeenCalled();
  });

  it('shows the last result at once when it has one', async () => {
    const deps = depsOf({ loadSnapshot: vi.fn(async () => ({ at: NOW - 5 * 60_000, cards: inventory })) });
    await mountAccountPanel(document, deps).ready;
    expect(el('accountStats').hidden).toBe(false);
    expect(text('accountCards')).toBe('16');
    expect(text('accountCardsNote')).toBe('уникальных 4 · осколков 4 · без цены 3');
    expect(text('accountBank')).toBe('13.2');
    expect(text('accountBankNote')).toBe('по рангам: 2S · 1.2A · 10F');
    expect(el('accountR').hidden).toBe(true);
    expect(button('accountLoad').textContent).toBe('Обновить');
    expect(el('accountClear').hidden).toBe(false);
    expect(text('accountHint')).toBe('Обновлено 5 мин назад. Данные хранятся только в этом браузере.');
    expect(deps.fetchCards).not.toHaveBeenCalled();
  });

  it('reads the token, loads the cards, keeps them and shows the totals', async () => {
    const deps = depsOf();
    const panel = mountAccountPanel(document, deps);
    await panel.ready;
    await press('accountLoad');
    expect(deps.readToken).toHaveBeenCalledOnce();
    expect(deps.fetchCards).toHaveBeenCalledWith('token', expect.any(Function));
    expect(deps.saveSnapshot).toHaveBeenCalledWith(inventory, NOW);
    expect(text('accountCards')).toBe('16');
    expect(text('accountBank')).toBe('13.2');
    expect(text('accountHint')).toBe('Обновлено только что. Данные хранятся только в этом браузере.');
    expect(button('accountLoad').disabled).toBe(false);
    expect(button('accountLoad').textContent).toBe('Обновить');
  });

  it('shows the progress and keeps the buttons off while it loads', async () => {
    let release: (cards: AccountCard[]) => void = () => undefined;
    const fetchCards = vi.fn(
      (_token: string, onProgress: (loaded: number) => void) =>
        new Promise<AccountCard[]>((resolveCards) => {
          onProgress(1234);
          release = resolveCards;
        })
    );
    await mountAccountPanel(document, depsOf({ fetchCards })).ready;
    await press('accountLoad');
    expect(text('accountHint')).toBe('Загружено записей: 1 234');
    expect(button('accountLoad').disabled).toBe(true);
    expect(button('accountLoad').textContent).toBe('Загрузка…');
    release(inventory);
    await flush();
    expect(button('accountLoad').disabled).toBe(false);
    expect(text('accountCards')).toBe('16');
  });

  it('does not start a second load while one is running', async () => {
    let release: (cards: AccountCard[]) => void = () => undefined;
    const fetchCards = vi.fn((_token: string, _onProgress: (loaded: number) => void) => new Promise<AccountCard[]>((resolveCards) => (release = resolveCards)));
    await mountAccountPanel(document, depsOf({ fetchCards })).ready;
    el('accountLoad').click();
    el('accountLoad').click();
    await flush();
    release(inventory);
    await flush();
    expect(fetchCards).toHaveBeenCalledOnce();
  });

  it('tells when there is no token and asks the api for nothing', async () => {
    const deps = depsOf({ readToken: vi.fn(async () => null) });
    await mountAccountPanel(document, deps).ready;
    await press('accountLoad');
    expect(text('accountHint')).toBe('Не найден токен: войдите в аккаунт на сайте и повторите.');
    expect(el('accountHint').classList.contains('hint--error')).toBe(true);
    expect(deps.fetchCards).not.toHaveBeenCalled();
    expect(button('accountLoad').disabled).toBe(false);
    expect(button('accountLoad').textContent).toBe('Показать');
  });

  it.each([
    [new ApiError('graphql', null, true), 'Сайт не принял токен: войдите в аккаунт заново.'],
    [new ApiError('http', 401, true), 'Сайт не принял токен: войдите в аккаунт заново.'],
    [new ApiError('http', 503), 'Не удалось загрузить (HTTP 503): попробуйте позже.'],
    [new ApiError('network'), 'Не удалось загрузить: попробуйте позже.'],
    [new ApiError('redirect', 302), 'Сайт ответил перенаправлением, запрос остановлен.'],
    [new ApiError('limit'), 'Слишком много карт для одного запроса.'],
    [new Error('boom'), 'Не удалось загрузить: попробуйте позже.'],
  ])('puts a failure into words: %s', async (error, message) => {
    expect(messageFor(error)).toBe(message);
    const deps = depsOf({ fetchCards: vi.fn(async () => Promise.reject(error)) });
    await mountAccountPanel(document, deps).ready;
    await press('accountLoad');
    expect(text('accountHint')).toBe(message);
    expect(el('accountHint').classList.contains('hint--error')).toBe(true);
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the last result on screen when a refresh fails', async () => {
    const deps = depsOf({
      loadSnapshot: vi.fn(async () => ({ at: NOW, cards: inventory })),
      fetchCards: vi.fn(async () => Promise.reject(new ApiError('http', 500))),
    });
    await mountAccountPanel(document, deps).ready;
    await press('accountLoad');
    expect(el('accountStats').hidden).toBe(false);
    expect(text('accountCards')).toBe('16');
    expect(text('accountHint')).toContain('HTTP 500');
    expect(button('accountLoad').textContent).toBe('Обновить');
  });

  it('opens a window for R only when the account has R', async () => {
    const plain = depsOf({ loadSnapshot: vi.fn(async () => ({ at: NOW, cards: inventory })) });
    await mountAccountPanel(document, plain).ready;
    expect(el('accountR').hidden).toBe(true);
    document.body.innerHTML = markup;
    const withR = depsOf({ loadSnapshot: vi.fn(async () => ({ at: NOW, cards: [...inventory, own('r-card', 2)] })) });
    await mountAccountPanel(document, withR).ready;
    expect(el('accountR').hidden).toBe(false);
    expect(text('accountRCards')).toBe('2');
    expect(text('accountRCoins')).toBe('2');
    expect(text('accountRNote')).toBe('Считается отдельно от банка');
    expect(text('accountCards')).toBe('18');
    expect(text('accountBank')).toBe('13.2');
  });

  it('lists R shards in the window without valuing them', async () => {
    const deps = depsOf({ loadSnapshot: vi.fn(async () => ({ at: NOW, cards: [own('r-card', 3, true)] })) });
    await mountAccountPanel(document, deps).ready;
    expect(el('accountR').hidden).toBe(false);
    expect(text('accountRCards')).toBe('0');
    expect(text('accountRNote')).toBe('Осколков: 3 (не оцениваются)');
  });

  it('prices the bank again when the commission changes', async () => {
    let commission = true;
    const deps = depsOf({ loadSnapshot: vi.fn(async () => ({ at: NOW, cards: inventory })), commission: () => commission });
    const panel = mountAccountPanel(document, deps);
    await panel.ready;
    expect(text('accountBank')).toBe('13.2');
    commission = false;
    await panel.refresh();
    expect(text('accountBank')).toBe('16.5');
    expect(text('accountBankNote')).toBe('по рангам: 2.5S · 1.5A · 12.5F');
  });

  it('forgets the cards on request', async () => {
    const deps = depsOf({ loadSnapshot: vi.fn(async () => ({ at: NOW, cards: inventory })) });
    await mountAccountPanel(document, deps).ready;
    await press('accountClear');
    expect(deps.clearSnapshot).toHaveBeenCalledOnce();
    expect(el('accountStats').hidden).toBe(true);
    expect(el('accountClear').hidden).toBe(true);
    expect(button('accountLoad').textContent).toBe('Показать');
    expect(text('accountHint')).toContain('api.senkuro.com');
  });

  it('starts empty when the saved data cannot be read', async () => {
    const deps = depsOf({ loadSnapshot: vi.fn(async () => Promise.reject(new Error('storage'))) });
    await mountAccountPanel(document, deps).ready;
    expect(el('accountStats').hidden).toBe(true);
  });

  it('does nothing when the popup has no account block', async () => {
    document.body.innerHTML = '';
    const panel = mountAccountPanel(document, depsOf());
    await expect(panel.ready).resolves.toBeUndefined();
    await expect(panel.refresh()).resolves.toBeUndefined();
  });
});

describe('number and time words', () => {
  it('groups thousands with a non-breaking space', () => {
    expect(formatCount(1234567)).toBe('1 234 567');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(0)).toBe('0');
    expect(formatCoins(1234.5)).toBe('1 234.5');
    expect(formatCoins(12)).toBe('12');
    expect(formatCoins(0.004)).toBe('0');
  });

  it('says how long ago the cards were read', () => {
    expect(ago(NOW, NOW)).toBe('только что');
    expect(ago(NOW - 59_000, NOW)).toBe('только что');
    expect(ago(NOW - 60_000, NOW)).toBe('1 мин назад');
    expect(ago(NOW - 59 * 60_000, NOW)).toBe('59 мин назад');
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe('3 ч назад');
    expect(ago(NOW - 49 * 3_600_000, NOW)).toBe('2 дн назад');
    expect(ago(NOW + 5_000, NOW)).toBe('только что');
  });
});
