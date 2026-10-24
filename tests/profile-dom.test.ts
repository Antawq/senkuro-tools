import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  abortProfileLoading,
  findNicknameTarget,
  forgetProfileBadge,
  isTradeOpen,
  profileBadgeMissing,
  removeProfileBadge,
  updateProfileBadge,
  WIDGET_ID,
} from '../utils/profile/profile-dom';

const db = {
  'soran-f': { price: 1, name: 'Соран', rank: 'F' },
  'luffy-s': { price: 2, name: 'Луффи', rank: 'S' },
  'zoro-r': { price: 2, name: 'Зоро', rank: 'R' },
  'nami-a': { price: 1, name: 'Нами', rank: 'A' },
};

const plain = { commission: false, valueBySplit: false, valueBasis: 'bank' as const, excludeShards: false };

const header = `
  <div class="client-header">
    <header><h1 class="caption">phaivroh</h1></header>
  </div>`;

const store = (cards: [string, number, 0 | 1][]) =>
  fakeBrowser.storage.local.set({ profileCollections: { phaivroh: { at: Date.now(), userId: 'u1', cards, after: null, pages: 1 } } });

const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

const cardsPage = (slugs: string[], next: string | null) =>
  reply({
    userCards: {
      pageInfo: { hasNextPage: next !== null, endCursor: next },
      edges: slugs.map((slug) => ({ node: { quantity: 1, shard: false, card: { slug } } })),
    },
  });

const bodyOf = (init?: RequestInit) =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { operationName?: string; variables?: { after?: string | null } };

const operationOf = (init?: RequestInit) => bodyOf(init).operationName;

const hangsUntilAborted = (init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

const widget = () => document.getElementById(WIDGET_ID);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const until = async (done: () => boolean) => {
  for (let pass = 0; pass < 50 && !done(); pass++) await settle();
};

const draw = async (valuation = plain) => {
  updateProfileBadge({ db, valuation });
  await settle();
  updateProfileBadge({ db, valuation });
};

const openTrade = () => {
  const modal = document.createElement('div');
  modal.className = 'modal-content modal-content--trade';
  document.body.append(modal);
  return modal;
};

describe('profile-dom', () => {
  let fetchMock: Mock<typeof fetch>;

  const asked = () => fetchMock.mock.calls.map(([, init]) => [operationOf(init), bodyOf(init).variables?.after ?? null]);
  const value = () => widget()?.querySelector('.senkuro-f-value')?.textContent;

  beforeEach(() => {
    fakeBrowser.reset();
    document.body.innerHTML = '';
    fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(reply({ user: null })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    abortProfileLoading();
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

  describe('forgetProfileBadge', () => {
    const drawn = async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([['soran-f', 1, 0]]);
      await draw();
      await until(() => value() !== undefined);
    };

    it('drops the stored collection and what the page remembers, so the chip asks to count again', async () => {
      await drawn();
      expect(value()).toBeDefined();
      await forgetProfileBadge('phaivroh');
      expect((await fakeBrowser.storage.local.get('profileCollections')).profileCollections).toEqual({});
      await draw();
      await until(() => widget()?.textContent?.includes('Посчитать ценность') === true);
      expect(widget()?.textContent).toContain('Посчитать ценность');
      expect(value()).toBeUndefined();
    });

    it('stops a count that is running for that profile', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      fetchMock.mockImplementation((_input, init) => hangsUntilAborted(init));
      await draw();
      (widget() as HTMLElement).click();
      await settle();
      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(init?.signal?.aborted).toBe(false);
      await forgetProfileBadge('phaivroh');
      expect(init?.signal?.aborted).toBe(true);
    });

    it('does not store the pages of a count it stopped', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      let cardsAsked = 0;
      fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => {
        if (operationOf(init) === 'User') return Promise.resolve(reply({ user: { id: 'u1', name: 'phaivroh' } }));
        return ++cardsAsked === 1 ? Promise.resolve(cardsPage(['luffy-s'], 'c1')) : hangsUntilAborted(init);
      });
      await draw();
      (widget() as HTMLElement).click();
      await until(() => cardsAsked === 2);
      await forgetProfileBadge('phaivroh');
      for (let pass = 0; pass < 10; pass++) await settle();
      expect((await fakeBrowser.storage.local.get('profileCollections')).profileCollections ?? {}).toEqual({});
    });
  });

  describe('updateProfileBadge', () => {
    it('does nothing when not on a profile page', () => {
      window.history.pushState({}, '', '/cards/soran-f');
      updateProfileBadge({ db, valuation: plain });
      expect(widget()).toBeNull();
    });

    it('draws nothing until the store has answered', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      updateProfileBadge({ db, valuation: plain });
      expect(widget()).toBeNull();
      expect(profileBadgeMissing()).toBe(true);
    });

    it('puts a count button next to the nickname and asks the site for nothing until it is clicked', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = `
        <div class="client-panel__info">
          <div class="client-header">
            <header><h1 class="caption">phaivroh</h1></header>
            <a href="/levels">8</a>
          </div>
        </div>
      `;
      await draw();
      expect(widget()?.classList.contains('senkuro-profile-f-chip')).toBe(true);
      expect(widget()?.textContent).toContain('Посчитать ценность');
      expect(widget()?.querySelector('.senkuro-chip-spinner')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      (widget() as HTMLElement).click();
      expect(widget()?.textContent).toContain('Считаем F...');
      expect(widget()?.querySelectorAll('.senkuro-f-chip-content > .senkuro-chip-spinner, .senkuro-f-chip-content > .senkuro-f-text')).toHaveLength(2);
    });

    it('shows a collection another tab counted without a click or a request', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([
        ['luffy-s', 1, 0],
        ['soran-f', 2, 0],
      ]);
      await draw();
      expect(value()).toBe('488F');
      expect(widget()?.querySelectorAll('.senkuro-popover-row')).toHaveLength(2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('formats popover with the bank value of shards, the shard count and R first', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([
        ['luffy-s', 1, 0],
        ['zoro-r', 2, 0],
        ['nami-a', 1, 1],
        ['zoro-r', 1, 1],
      ]);
      await draw();
      const popover = widget()?.querySelector('.senkuro-profile-f-popover');
      const [bank, cards] = [...(popover?.querySelectorAll('.senkuro-row-val') ?? [])].map((cell) => cell.textContent);
      expect(bank).toBe('4R 2oR 2S 1oA');
      expect(cards).toBe('2R 1oR 1S 1oA');
      expect(popover?.querySelector('.senkuro-rank-r')?.textContent).toBe('4R');
      expect(popover?.querySelector('.senkuro-popover-meta')?.textContent).toBe('Всего: 3 карт · 2 осколков');
    });

    it('lists cards and shards the database does not know under ?, so the cards row adds up to the totals', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([
        ['luffy-s', 1, 0],
        ['brand-new-s', 2, 0],
        ['brand-new-s', 2, 1],
      ]);
      await draw();
      const popover = widget()?.querySelector('.senkuro-profile-f-popover');
      const [, cards] = [...(popover?.querySelectorAll('.senkuro-row-val') ?? [])].map((cell) => cell.textContent);
      expect(cards).toBe('1S 2? 2o?');
      expect([...(popover?.querySelectorAll('span[title]') ?? [])].map((item) => [item.textContent, item.getAttribute('title')])).toEqual([
        ['2?', '? - нет цены в базе'],
        ['2o?', '? - нет цены в базе'],
      ]);
      expect(popover?.querySelector('.senkuro-popover-meta')?.textContent).toBe('Всего: 3 карт · 2 осколков');
    });

    describe('popover position', () => {
      const POPOVER_RECT = { left: 300, right: 650 } as DOMRect;
      const SHIFT = '--senkuro-popover-shift';

      const shiftOf = () => widget()?.querySelector<HTMLElement>('.senkuro-profile-f-popover')?.style.getPropertyValue(SHIFT);

      const underCursor = (isHovered: boolean) => {
        const matches = Reflect.get(Element.prototype, 'matches') as (this: Element, selector: string) => boolean;
        vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
          return selector === ':hover' ? isHovered && this.id === WIDGET_ID : matches.call(this, selector);
        });
      };

      beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('senkuro-profile-f-popover') ? POPOVER_RECT : new DOMRect();
        });
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(500);
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      const showCollection = async () => {
        window.history.pushState({}, '', '/users/phaivroh');
        document.body.innerHTML = header;
        await store([['luffy-s', 1, 0]]);
        await draw();
      };

      it('pulls the popover back into the window when it appears under the cursor', async () => {
        underCursor(true);
        await showCollection();
        expect(shiftOf()).toBe('-150px');
      });

      it('pulls a popover back into the window when it is redrawn while it is open', async () => {
        underCursor(false);
        await showCollection();
        widget()?.classList.add('senkuro-popover-active');
        updateProfileBadge({ db, valuation: { ...plain, commission: true } });
        expect(shiftOf()).toBe('-150px');
      });

      it('leaves the popover where it is until the cursor enters the chip', async () => {
        underCursor(false);
        await showCollection();
        expect(shiftOf()).toBe('');
        widget()?.dispatchEvent(new MouseEvent('mouseenter'));
        expect(shiftOf()).toBe('-150px');
      });
    });

    it('works on /users/phaivroh/cards subpage as well', async () => {
      window.history.pushState({}, '', '/users/phaivroh/cards');
      document.body.innerHTML = header;
      await draw();
      expect(widget()?.dataset.slug).toBe('phaivroh');
    });

    it('recalculates when the valuation changes without loading the cards again', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([['luffy-s', 1, 0]]);
      await draw();
      expect(value()).toBe('486F');
      updateProfileBadge({ db, valuation: { ...plain, commission: true } });
      expect(value()).toBe('388.8F');
      updateProfileBadge({ db, valuation: { ...plain, valueBySplit: true } });
      expect(value()).toBe('64F');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('recalculates when shards are left out of the value, keeping them in the lists', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([
        ['luffy-s', 1, 0],
        ['soran-f', 1, 1],
      ]);
      await draw();
      expect(value()).toBe('487F');
      updateProfileBadge({ db, valuation: { ...plain, excludeShards: true } });
      expect(value()).toBe('486F');
      expect(widget()?.querySelector('.senkuro-popover-meta')?.textContent).toContain('1 осколков');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('listens for clicks outside once, however often it draws', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([['luffy-s', 1, 0]]);
      const listen = vi.spyOn(document, 'addEventListener');
      await draw();
      for (const commission of [true, false, true, false]) updateProfileBadge({ db, valuation: { ...plain, commission } });
      removeProfileBadge();
      await draw();
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
              release = () => resolve(cardsPage(['luffy-s'], null));
            })
      );
      await draw();
      (widget() as HTMLElement).click();
      await until(() => asked().some(([operation]) => operation === 'UserCards'));
      removeProfileBadge();
      await draw();
      expect(widget()?.textContent).toContain('Считаем F...');
      release();
      await until(() => value() !== undefined);
      expect(value()).toBe('486F');
    });

    it('stops answering clicks with a reload once a retry has succeeded', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await draw();
      (widget() as HTMLElement).click();
      await until(() => widget()?.textContent?.includes('ошибка (повторить)') ?? false);
      expect(widget()?.textContent).toContain('ошибка (повторить)');

      fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
        Promise.resolve(operationOf(init) === 'User' ? reply({ user: { id: 'u1', name: 'phaivroh' } }) : cardsPage(['luffy-s'], null))
      );
      (widget() as HTMLElement).click();
      await until(() => value() !== undefined);
      expect(value()).toBe('486F');

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

    describe('when a trade window interrupts the count', () => {
      beforeEach(() => {
        window.history.pushState({}, '', '/users/phaivroh');
        document.body.innerHTML = header;
      });

      it('stops loading without reporting an error', async () => {
        fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
          operationOf(init) === 'User' ? Promise.resolve(reply({ user: { id: 'u1', name: 'phaivroh' } })) : hangsUntilAborted(init)
        );
        await draw();
        (widget() as HTMLElement).click();
        await until(() => asked().some(([operation]) => operation === 'UserCards'));
        expect(widget()?.textContent).toContain('Считаем F...');

        openTrade();
        expect(isTradeOpen()).toBe(true);
        updateProfileBadge({ db, valuation: plain });
        await settle();
        expect(widget()?.textContent).not.toContain('ошибка (повторить)');
      });

      it('leaves a chip that can be clicked again, without waiting for another pass', async () => {
        fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
          operationOf(init) === 'User' ? Promise.resolve(reply({ user: { id: 'u1', name: 'phaivroh' } })) : hangsUntilAborted(init)
        );
        await draw();
        (widget() as HTMLElement).click();
        await until(() => asked().some(([operation]) => operation === 'UserCards'));
        const modal = openTrade();
        updateProfileBadge({ db, valuation: plain });
        await settle();
        expect(widget()?.textContent).toContain('Посчитать ценность');
        expect(widget()?.querySelector('.senkuro-chip-spinner')).toBeNull();

        modal.remove();
        const calls = fetchMock.mock.calls.length;
        (widget() as HTMLElement).click();
        expect(widget()?.textContent).toContain('Считаем F...');
        await until(() => fetchMock.mock.calls.length > calls);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
      });

      it('continues from the last page it got once the window is gone', async () => {
        let secondPage = 0;
        fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => {
          if (operationOf(init) === 'User') return Promise.resolve(reply({ user: { id: 'u1', name: 'phaivroh' } }));
          if (!bodyOf(init).variables?.after) return Promise.resolve(cardsPage(['luffy-s'], 'c1'));
          return ++secondPage === 1 ? hangsUntilAborted(init) : Promise.resolve(cardsPage(['soran-f'], null));
        });
        await draw();
        (widget() as HTMLElement).click();
        await until(() => secondPage === 1);
        const modal = openTrade();
        updateProfileBadge({ db, valuation: plain });
        await settle();
        modal.remove();

        (widget() as HTMLElement).click();
        await until(() => value() !== undefined);
        expect(value()).toBe('487F');
        expect(asked()).toEqual([
          ['User', null],
          ['UserCards', null],
          ['UserCards', 'c1'],
          ['UserCards', 'c1'],
        ]);
      });
    });

    it('keeps the pages it got when the site refuses and continues from them on the next click', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      let secondPage = 0;
      fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => {
        if (operationOf(init) === 'User') return Promise.resolve(reply({ user: { id: 'u1', name: 'phaivroh' } }));
        if (!bodyOf(init).variables?.after) return Promise.resolve(cardsPage(['luffy-s'], 'c1'));
        return Promise.resolve(++secondPage === 1 ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : cardsPage(['soran-f'], null));
      });
      await draw();
      (widget() as HTMLElement).click();
      await until(() => widget()?.textContent?.includes('ошибка (повторить)') ?? false);
      expect(widget()?.textContent).toContain('ошибка (повторить)');

      (widget() as HTMLElement).click();
      await until(() => value() !== undefined);
      expect(value()).toBe('487F');
      expect(asked()).toEqual([
        ['User', null],
        ['UserCards', null],
        ['UserCards', 'c1'],
        ['UserCards', 'c1'],
      ]);
    });

    it('counts from scratch when asked to refresh and stores the new cards', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await store([['luffy-s', 1, 0]]);
      await draw();
      expect(value()).toBe('486F');

      fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
        Promise.resolve(operationOf(init) === 'User' ? reply({ user: { id: 'u1', name: 'phaivroh' } }) : cardsPage(['soran-f'], null))
      );
      (widget()?.querySelector('.senkuro-popover-refresh') as HTMLElement).click();
      await until(() => value() === '1F');
      expect(value()).toBe('1F');
      expect(asked()).toEqual([
        ['User', null],
        ['UserCards', null],
      ]);
      await settle();
      const { profileCollections } = await fakeBrowser.storage.local.get('profileCollections');
      expect((profileCollections as Record<string, { cards: unknown }>).phaivroh?.cards).toEqual([['soran-f', 1, 0]]);
    });

    it('uses a count another tab finished after this tab drew its button', async () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = header;
      await draw();
      expect(widget()?.textContent).toContain('Посчитать ценность');
      await store([['luffy-s', 1, 0]]);
      (widget() as HTMLElement).click();
      await until(() => value() !== undefined);
      expect(value()).toBe('486F');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
