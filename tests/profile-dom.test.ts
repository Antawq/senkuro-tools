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
    it('finds .client-header with header element on Senkuro profile', () => {
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
      expect(target?.container.classList.contains('client-header')).toBe(true);
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
      expect(widget?.dataset.slug).toBe('phaivroh');
      expect(widget?.textContent).toContain('💎');
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
  });
});
