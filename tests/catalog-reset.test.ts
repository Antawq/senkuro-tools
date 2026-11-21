import { afterEach, describe, expect, it, vi } from 'vitest';

import { RESET_CLASS, RESET_TEXT, isCatalogResetStale, syncCatalogReset } from '../utils/catalog/catalog-reset';
import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';

const catalog = ({ isDirty, isEmpty }: { isDirty: boolean; isEmpty: boolean }) => `
  <div class="catalog">
    <div class="catalog-cnt">
      <div class="catalog-cnt__nav"><button class="button">По популярности</button></div>
      <div class="catalog-cnt__filter"></div>
      ${isEmpty ? '<div class="empty"><div class="empty__label">Манга не найдена</div></div>' : '<div class="catalog-cnt__result"><article></article></div>'}
    </div>
    <aside class="catalog-filter">
      <div class="catalog-filter__header">
        <span>Фильтры</span>
        <button class="button button--secondary button--icon${isDirty ? ' button--chip' : ''}" aria-label="Сбросить"></button>
      </div>
    </aside>
  </div>`;

const open = (path: string, state: { isDirty: boolean; isEmpty: boolean }) => {
  window.history.pushState({}, '', path);
  document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
  document.body.innerHTML = catalog(state);
};

const ownButtons = () => [...document.querySelectorAll<HTMLButtonElement>(`.${RESET_CLASS}`)];

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);
});

describe('syncCatalogReset', () => {
  it('shows the reset next to the sort controls of a filtered title catalog and presses the site reset', () => {
    open('/browse/manga/genres/action', { isDirty: true, isEmpty: false });
    const siteClick = vi.fn();
    document.querySelector('.catalog-filter__header button')?.addEventListener('click', siteClick);
    syncCatalogReset(document);
    expect(ownButtons().map((button) => [button.parentElement?.className, button.textContent])).toEqual([['catalog-cnt__nav', RESET_TEXT]]);
    ownButtons()[0]?.click();
    expect(siteClick).toHaveBeenCalledOnce();
  });

  it('adds the reset to the empty result too', () => {
    open('/browse/manga/search/zzz', { isDirty: true, isEmpty: true });
    syncCatalogReset(document);
    expect(ownButtons().map((button) => button.parentElement?.className)).toEqual(['catalog-cnt__nav', 'empty']);
  });

  it('draws nothing while the catalog is not filtered and removes the reset once it is cleared', () => {
    open('/browse/manga', { isDirty: false, isEmpty: false });
    syncCatalogReset(document);
    expect(ownButtons()).toHaveLength(0);
    open('/browse/manga/genres/action', { isDirty: true, isEmpty: false });
    syncCatalogReset(document);
    document.querySelector('.catalog-filter__header button')?.classList.remove('button--chip');
    syncCatalogReset(document);
    expect(ownButtons()).toHaveLength(0);
  });

  it('leaves the card catalog alone', () => {
    open('/browse/cards/ranks/s', { isDirty: true, isEmpty: false });
    syncCatalogReset(document);
    expect(ownButtons()).toHaveLength(0);
  });

  it('serves the anime catalog of the anime site the same way', () => {
    open('/browse/anime/genres/action', { isDirty: true, isEmpty: false });
    syncCatalogReset(document);
    expect(ownButtons()).toHaveLength(1);
  });
});

describe('isCatalogResetStale', () => {
  it('asks for a render when the drawn reset no longer matches the filter state', () => {
    open('/browse/manga/genres/action', { isDirty: true, isEmpty: false });
    expect(isCatalogResetStale(document)).toBe(true);
    syncCatalogReset(document);
    expect(isCatalogResetStale(document)).toBe(false);
    document.querySelector('.catalog-filter__header button')?.classList.remove('button--chip');
    expect(isCatalogResetStale(document)).toBe(true);
  });
});
