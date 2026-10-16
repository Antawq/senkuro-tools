import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { findNicknameTarget, isTradeOpen, profileBadgeMissing, removeProfileBadge, updateProfileBadge, WIDGET_ID } from '../utils/profile-dom';

const db = {
  'soran-f': { price: 1, name: 'Соран', rank: 'F' },
  'luffy-s': { price: 2, name: 'Луффи', rank: 'S' },
  'zoro-r': { price: 2, name: 'Зоро', rank: 'R' },
  'nami-a': { price: 1, name: 'Нами', rank: 'A' },
};

const plain = { commission: false, valueBySplit: false, valueBasis: 'bank' as const };

const header = `
  <div class="client-header">
    <header><h1 class="caption">phaivroh</h1></header>
  </div>`;

const cache = (cards: [string, number, 0 | 1][]) => sessionStorage.setItem('senkutools:profile_cards:phaivroh', JSON.stringify({ at: Date.now(), cards }));

const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

const operationOf = (init?: RequestInit) => (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { operationName?: string }).operationName;

const widget = () => document.getElementById(WIDGET_ID);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('profile-dom', () => {
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(reply({ user: null })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    removeProfileBadge();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('findNicknameTarget', () => {
    it('finds header element containing h1 on Senkuro profile', () => {
      document.body.innerHTML = `
        <div class="client-panel__info">
          <div class="client-header">
            <header>
              <h1 class="caption caption-size-lg">phaivroh</h1>
            </header>
            <a href="/levels" class="lvl"><div class="lvl__tag">8</div></a>
          </div>
        </div>
      `;
      const target = findNicknameTarget();
      expect(target).not.toBeNull();
      expect(target?.container.tagName).toBe('HEADER');
    });

    it('falls back to h1 when .client-header is not present', () => {
      document.body.innerHTML = `
        <div class="client-panel__info">
          <h1 class="caption caption-size-lg">phaivroh</h1>
        </div>
      `;
      expect(findNicknameTarget()).not.toBeNull();
    });
  });

  describe('updateProfileBadge', () => {
    it('does nothing when not on a profile page', () => {
      window.history.pushState({}, '', '/cards/soran-f');
      updateProfileBadge({ db, valuation: plain });
      expect(widget()).toBeNull();
    });

    it('shows a count button and starts loading only on click', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = `
        <div class="client-panel__info">
          <div class="client-header">
            <header><h1 class="caption">phaivroh</h1></header>
            <a href="/levels">8</a>
          </div>
        </div>
      `;
      updateProfileBadge({ db, valuation: plain });
      expect(widget()?.classList.contains('senkuro-profile-f-chip')).toBe(true);
      expect(widget()?.textContent).toContain('Посчитать ценность');
      expect(widget()?.querySelector('.senkuro-chip-spinner')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      (widget() as HTMLElement).click();
      expect(widget()?.textContent).toContain('Считаем F...');
      expect(widget()?.querySelector('.senkuro-chip-spinner')).not.toBeNull();
    });

    it('renders cached cards immediately', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      cache([
        ['luffy-s', 1, 0],
        ['soran-f', 2, 0],
      ]);
      updateProfileBadge({ db, valuation: plain });
      expect(widget()?.querySelector('.senkuro-f-value')?.textContent).toBe('488F');
      expect(widget()?.querySelectorAll('.senkuro-popover-row')).toHaveLength(2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('formats popover with the bank value of shards, the shard count and R first', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      cache([
        ['luffy-s', 1, 0],
        ['zoro-r', 2, 0],
        ['nami-a', 1, 1],
        ['zoro-r', 1, 1],
      ]);
      updateProfileBadge({ db, valuation: plain });
      const popover = widget()?.querySelector('.senkuro-profile-f-popover');
      const [bank, cards] = [...(popover?.querySelectorAll('.senkuro-row-val') ?? [])].map((cell) => cell.textContent);
      expect(bank).toBe('4R 2oR 2S 1oA');
      expect(cards).toBe('2R 1oR 1S 1oA');
      expect(popover?.querySelector('.senkuro-rank-r')?.textContent).toBe('4R');
      expect(popover?.querySelector('.senkuro-popover-meta')?.textContent).toBe('Всего: 3 карт · 2 осколков');
    });

    it('works on /users/phaivroh/cards subpage as well', () => {
      window.history.pushState({}, '', '/users/phaivroh/cards');
      document.body.innerHTML = header;
      updateProfileBadge({ db, valuation: plain });
      expect(widget()?.dataset.slug).toBe('phaivroh');
    });

    it('recalculates when the valuation changes without loading the cards again', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      cache([['luffy-s', 1, 0]]);
      updateProfileBadge({ db, valuation: plain });
      expect(widget()?.querySelector('.senkuro-f-value')?.textContent).toBe('486F');
      updateProfileBadge({ db, valuation: { ...plain, commission: true } });
      expect(widget()?.querySelector('.senkuro-f-value')?.textContent).toBe('388.8F');
      updateProfileBadge({ db, valuation: { ...plain, valueBySplit: true } });
      expect(widget()?.querySelector('.senkuro-f-value')?.textContent).toBe('64F');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('listens for clicks outside once, however often it draws', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      cache([['luffy-s', 1, 0]]);
      const listen = vi.spyOn(document, 'addEventListener');
      for (const commission of [true, false, true, false]) updateProfileBadge({ db, valuation: { ...plain, commission } });
      removeProfileBadge();
      updateProfileBadge({ db, valuation: plain });
      expect(listen.mock.calls.filter(([type]) => type === 'click').length).toBeLessThanOrEqual(1);
    });

    it('shows the value on the badge drawn again while the cards were still loading', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      let release: () => void = () => undefined;
      fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
        operationOf(init) === 'User'
          ? Promise.resolve(reply({ user: { id: 'u1', name: 'phaivroh' } }))
          : new Promise<Response>((resolve) => {
              release = () =>
                resolve(
                  reply({
                    userCards: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      edges: [{ node: { quantity: 1, shard: false, card: { slug: 'luffy-s' } } }],
                    },
                  })
                );
            })
      );
      updateProfileBadge({ db, valuation: plain });
      (widget() as HTMLElement).click();
      await settle();
      removeProfileBadge();
      updateProfileBadge({ db, valuation: plain });
      expect(widget()?.textContent).toContain('Считаем F...');
      release();
      await settle();
      await settle();
      expect(widget()?.querySelector('.senkuro-f-value')?.textContent).toBe('486F');
    });

    it('stops answering clicks with a reload once a retry has succeeded', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      updateProfileBadge({ db, valuation: plain });
      (widget() as HTMLElement).click();
      await settle();
      expect(widget()?.textContent).toContain('ошибка (повторить)');

      fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
        Promise.resolve(
          operationOf(init) === 'User'
            ? reply({ user: { id: 'u1', name: 'phaivroh' } })
            : reply({
                userCards: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [{ node: { quantity: 1, shard: false, card: { slug: 'luffy-s' } } }] },
              })
        )
      );
      (widget() as HTMLElement).click();
      await settle();
      await settle();
      expect(widget()?.querySelector('.senkuro-f-value')?.textContent).toBe('486F');

      const calls = fetchMock.mock.calls.length;
      (widget()?.querySelector('.senkuro-popover-meta') as HTMLElement).click();
      await settle();
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('does not calculate profile value or show badge when trade modal is open', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = `
        ${header}
        <div class="modal-content modal-content--trade"></div>
      `;
      expect(isTradeOpen()).toBe(true);
      expect(profileBadgeMissing()).toBe(false);
      updateProfileBadge({ db, valuation: plain });
      expect(widget()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts active profile loading when trade modal opens', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
        operationOf(init) === 'User' ? Promise.resolve(reply({ user: { id: 'u1', name: 'phaivroh' } })) : new Promise<Response>(() => undefined)
      );
      updateProfileBadge({ db, valuation: plain });
      (widget() as HTMLElement).click();
      await settle();
      expect(widget()?.textContent).toContain('Считаем F...');

      const modal = document.createElement('div');
      modal.className = 'modal-content modal-content--trade';
      document.body.append(modal);

      expect(isTradeOpen()).toBe(true);
      updateProfileBadge({ db, valuation: plain });
      expect(widget()?.textContent).not.toContain('ошибка (повторить)');
    });
  });
});
