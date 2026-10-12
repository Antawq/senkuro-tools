// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findNicknameTarget, removeProfileBadge, updateProfileBadge, WIDGET_ID } from '../utils/profile-dom';

const mockDb = {
  'soran-f': { price: 1.0, name: 'Соран', rank: 'F' },
};

describe('profile-dom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { user: null } }), { status: 200 })));
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
      const target = findNicknameTarget();
      expect(target).not.toBeNull();
    });
  });

  describe('updateProfileBadge', () => {
    it('does nothing when not on a profile page', () => {
      window.history.pushState({}, '', '/cards/soran-f');
      updateProfileBadge({ db: mockDb, commission: false });
      expect(document.getElementById(WIDGET_ID)).toBeNull();
    });

    it('inserts badge next to nickname when on profile page', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = `
        <div class="client-panel__info">
          <div class="client-header">
            <header><h1 class="caption">phaivroh</h1></header>
            <a href="/levels">8</a>
          </div>
        </div>
      `;

      updateProfileBadge({ db: mockDb, commission: false });
      const widget = document.getElementById(WIDGET_ID);
      expect(widget).not.toBeNull();
      expect(widget?.classList.contains('senkuro-profile-f-chip')).toBe(true);
      expect(widget?.textContent).toContain('Считаем F...');
      expect(widget?.querySelector('.senkuro-chip-spinner')).not.toBeNull();
    });

    it('renders cached summary immediately if available in sessionStorage', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = `
        <div class="client-header">
          <header><h1 class="caption">phaivroh</h1></header>
        </div>
      `;

      const summary = {
        totalF: 500000,
        formattedF: '500 000F',
        bank: ['S: 1', 'A: 2'],
        cards: ['S: 1', 'A: 2'],
        shards: [],
        totalCards: 3,
        totalShards: 0,
        rValue: null,
        rCards: 0,
      };
      sessionStorage.setItem(
        'senkutools:profile_f:phaivroh',
        JSON.stringify({ summary, timestamp: Date.now() })
      );

      updateProfileBadge({ db: mockDb, commission: false });
      const widget = document.getElementById(WIDGET_ID);
      expect(widget).not.toBeNull();
      expect(widget?.textContent).toContain('500 000F');
      expect(widget?.textContent).toContain('Банк:');
      expect(widget?.textContent).toContain('Карты:');
      const rows = widget?.querySelectorAll('.senkuro-popover-row');
      expect(rows?.length).toBe(2);
    });

    it('formats popover with bank (shards included) and cards (R first)', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = `
        <div class="client-header">
          <header><h1 class="caption">phaivroh</h1></header>
        </div>
      `;

      const summary = {
        totalF: 1250,
        formattedF: '1250F',
        bank: ['50R', '1000S', '200A'],
        cards: ['2R', '10S', '25A'],
        shards: ['1oR', '5oS', '2oA'],
        totalCards: 37,
        totalShards: 8,
        rValue: '50R',
        rCards: 2,
      };
      sessionStorage.setItem(
        'senkutools:profile_f:phaivroh',
        JSON.stringify({ summary, timestamp: Date.now() })
      );

      updateProfileBadge({ db: mockDb, commission: false });
      const widget = document.getElementById(WIDGET_ID);
      const popover = widget?.querySelector('.senkuro-profile-f-popover');
      expect(popover).not.toBeNull();
      expect(popover?.textContent).toContain('Банк:');
      expect(popover?.textContent).toContain('50R 1oR 1000S 200A 5oS 2oA');
      expect(popover?.textContent).toContain('Карты:');
      expect(popover?.textContent).toContain('2R 1oR 10S 25A 5oS 2oA');
      expect(popover?.querySelector('.senkuro-rank-r')?.textContent).toBe('50R');
    });

    it('works on /users/phaivroh/cards subpage as well', () => {
      window.history.pushState({}, '', '/users/phaivroh/cards');
      document.body.innerHTML = `
        <div class="client-header">
          <header><h1 class="caption">phaivroh</h1></header>
        </div>
      `;

      updateProfileBadge({ db: mockDb, commission: false });
      const widget = document.getElementById(WIDGET_ID);
      expect(widget).not.toBeNull();
      expect(widget?.dataset.slug).toBe('phaivroh');
    });

    it('renders clean chip without extra tags and selectable popover rows', () => {
      window.history.pushState({}, '', '/users/phaivroh');
      document.body.innerHTML = `
        <div class="client-header">
          <header><h1 class="caption">phaivroh</h1></header>
        </div>
      `;

      const summary = {
        totalF: 1250,
        formattedF: '1250F',
        bank: ['1000S'],
        cards: ['10S'],
        shards: ['5oS'],
        totalCards: 15,
        totalShards: 5,
        rValue: null,
        rCards: 0,
      };
      sessionStorage.setItem(
        'senkutools:profile_f:phaivroh',
        JSON.stringify({ summary, timestamp: Date.now() })
      );

      updateProfileBadge({ db: mockDb, commission: false });
      const widget = document.getElementById(WIDGET_ID);
      expect(widget?.querySelector('.senkuro-f-tag')).toBeNull();
      const chipValue = widget?.querySelector('.senkuro-f-value');
      expect(chipValue?.textContent).toBe('1250F');
      const popover = widget?.querySelector('.senkuro-profile-f-popover');
      expect(popover).not.toBeNull();
      expect(popover?.textContent).toContain('Банк:');
      expect(popover?.textContent).toContain('Карты:');
    });
  });
});
