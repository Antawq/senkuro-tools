import { beforeEach, describe, expect, it } from 'vitest';

import { canSelectCards, profileSlugOf, readSelectedCards } from '../utils/poster/poster-cards';

interface RowOptions {
  slug?: string | null;
  isSelected?: boolean;
  isShard?: boolean;
  tag?: string;
}

const LOCK_ICON = '<svg viewBox="0 -960 960 960"><path d="M240-80q-33 0-56.5-23.5T160-160v-400"></path></svg>';

const row = ({ slug = 'a-b-f', isSelected = true, isShard = false, tag }: RowOptions = {}): string => {
  const classes = ['card-collect-preview', 'user-card', isSelected ? 'user-card--selected' : '', isShard ? 'card-collect-preview--shard' : '']
    .filter(Boolean)
    .join(' ');
  const status = tag === undefined ? '' : `<span class="tag tag-size--md tag--dark">${tag}</span>`;
  const link = slug === null ? '' : `<a class="card-collect" href="/cards/${slug}"><div class="card-collect__front"></div></a>`;
  return `<div class="${classes}"><div class="card-collect-preview__status">${status}</div>${link}</div>`;
};

const grid = (...rows: string[]): string => `<div class="user-cards-grid">${rows.join('')}</div>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readSelectedCards', () => {
  it('returns only the selected rows of the grid, in page order', () => {
    document.body.innerHTML = grid(
      row({ slug: 'first-s' }),
      row({ slug: 'skipped-a', isSelected: false }),
      row({ slug: 'second-b' }),
      row({ slug: 'third-x' })
    );
    expect(readSelectedCards(document).map((card) => card.slug)).toEqual(['first-s', 'second-b', 'third-x']);
  });

  it('skips a selected shard row', () => {
    document.body.innerHTML = grid(row({ slug: 'card-a' }), row({ slug: 'shard-a', isShard: true }));
    expect(readSelectedCards(document)).toEqual([{ slug: 'card-a', quantity: 1 }]);
  });

  it('counts one card when the row has no quantity tag', () => {
    document.body.innerHTML = grid(row({ slug: 'single-c' }));
    expect(readSelectedCards(document)).toEqual([{ slug: 'single-c', quantity: 1 }]);
  });

  it('reads the leading number of the quantity tag', () => {
    document.body.innerHTML = grid(row({ slug: 'three-c', tag: ' 3 карты' }), row({ slug: 'twelve-d', tag: ' 12 карт' }));
    expect(readSelectedCards(document)).toEqual([
      { slug: 'three-c', quantity: 3 },
      { slug: 'twelve-d', quantity: 12 },
    ]);
  });

  it('counts one card for a locked row whose tag holds only the lock icon', () => {
    document.body.innerHTML = grid(row({ slug: 'locked-b', tag: LOCK_ICON }));
    expect(readSelectedCards(document)).toEqual([{ slug: 'locked-b', quantity: 1 }]);
  });

  it('reads the number after the lock icon of a locked row with copies', () => {
    document.body.innerHTML = grid(row({ slug: 'locked-s', tag: `${LOCK_ICON} 3 карты` }));
    expect(readSelectedCards(document)).toEqual([{ slug: 'locked-s', quantity: 3 }]);
  });

  it('skips a selected row without a card link or with an empty slug', () => {
    document.body.innerHTML = grid(row({ slug: null }), row({ slug: '' }), row({ slug: 'kept-a' }));
    expect(readSelectedCards(document)).toEqual([{ slug: 'kept-a', quantity: 1 }]);
  });

  it('ignores selected rows outside the cards grid', () => {
    document.body.innerHTML = `<div class="modal-trade__body-result">${row({ slug: 'modal-a' })}</div>${grid(row({ slug: 'grid-a' }))}`;
    expect(readSelectedCards(document)).toEqual([{ slug: 'grid-a', quantity: 1 }]);
  });

  it('returns nothing when the page has no grid', () => {
    expect(readSelectedCards(document)).toEqual([]);
  });
});

describe('canSelectCards', () => {
  it('is true for a toolbar with the more options button of the own cards page', () => {
    document.body.innerHTML = '<div class="user-card__filters"><button aria-label="sort"></button><button aria-label="more options"></button></div>';
    expect(canSelectCards(document.querySelector('.user-card__filters') as Element)).toBe(true);
  });

  it('is false for a toolbar without it, as on another user page', () => {
    document.body.innerHTML = '<div class="user-card__filters"><button aria-label="sort"></button></div>';
    expect(canSelectCards(document.querySelector('.user-card__filters') as Element)).toBe(false);
  });
});

describe('profileSlugOf', () => {
  it('reads the profile slug of a user page and of its cards page', () => {
    expect(profileSlugOf('/users/sena/cards')).toBe('sena');
    expect(profileSlugOf('/users/@249415776103056920')).toBe('@249415776103056920');
  });

  it('decodes an encoded slug', () => {
    expect(profileSlugOf('/users/%D0%BF/cards')).toBe('п');
  });

  it('is null for the reserved user paths and for pages outside the profiles', () => {
    expect(profileSlugOf('/users/settings')).toBeNull();
    expect(profileSlugOf('/users/notifications')).toBeNull();
    expect(profileSlugOf('/users/card-trades')).toBeNull();
    expect(profileSlugOf('/cards/x')).toBeNull();
  });
});
