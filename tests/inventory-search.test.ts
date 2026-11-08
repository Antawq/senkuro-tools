import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';
import type { Database } from '../utils/shared/database';
import {
  EMPTY_SEARCH_TEXT,
  findCardsSlug,
  isInventorySearchMissing,
  resetInventorySearchState,
  SEARCH_CLASS,
  syncInventorySearch,
} from '../utils/profile/inventory-search';

const database: Database = {
  'wh-felicity-f': { price: 1.5, name: 'Фелисити', rank: 'F', manga: 'Охотник на ведьм' },
  'ych-ёлка-s': { price: 9, name: 'Ёлка', rank: 'S', manga: 'Зимняя сказка' },
  'nar-sasuke-a': { price: 5, name: 'Саске Учиха', rank: 'A', manga: 'Наруто' },
};

const cardRow = (slug: string, name: string | null = null) =>
  `<div class="card-collect-preview user-card" data-id="${slug}">
    <div class="card-collect-preview__status"><span class="tag">1 карта</span></div>
    <div class="card-collect-preview__front">
      <a class="card-collect" href="/cards/${slug}">
        <div class="card-collect__front">
          ${name === null ? '<video></video>' : `<img class="card-collect__img" alt="${name}">`}
        </div>
      </a>
    </div>
  </div>`;

const CARDS_BODY_HTML = `
  <section class="client-body__item">
    <header class="back">
      <h2 class="caption">Все карточки</h2>
      <div class="back-actions">
        <div class="user-card__filters">
          <button id="direction" class="button button--secondary button--icon"></button>
          <div class="v-popper"></div>
          <div class="senkutools-poster__control"></div>
        </div>
      </div>
    </header>
    <div class="user-cards-grid">
      ${cardRow('wh-felicity-f', 'Фелисити')}
      ${cardRow('ych-ёлка-s', 'Ёлка')}
      ${cardRow('nar-sasuke-a', 'Саске')}
    </div>
  </section>`;

const setAppMounted = (isMounted: boolean) =>
  isMounted ? document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '') : document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);

const openPage = (path: string, hasBody = true, isMounted = true) => {
  window.history.pushState({}, '', path);
  document.body.innerHTML = hasBody ? CARDS_BODY_HTML : '<div class="client-body"></div>';
  setAppMounted(isMounted);
};

const findSearchControl = () => document.querySelector<HTMLElement>(`.${SEARCH_CLASS}`);
const findSearchInput = () => document.querySelector<HTMLInputElement>(`.${SEARCH_CLASS}__input`);
const findClearButton = () => document.querySelector<HTMLButtonElement>(`.${SEARCH_CLASS}__clear`);
const findEmptyNote = () => document.querySelector<HTMLElement>(`.${SEARCH_CLASS}__empty`);
const visibleCards = () => [...document.querySelectorAll<HTMLElement>('.user-cards-grid > .user-card:not([data-senkutools-filtered])')];

beforeEach(() => {
  resetInventorySearchState();
  openPage('/users/phaivroh/cards');
});

afterEach(() => {
  resetInventorySearchState();
  document.body.innerHTML = '';
});

describe('findCardsSlug', () => {
  it('extracts slug from valid cards path', () => {
    expect(findCardsSlug('/users/phaivroh/cards')).toBe('phaivroh');
    expect(findCardsSlug('/users/@12345/cards/')).toBe('@12345');
    expect(findCardsSlug('/users/settings/cards')).toBeNull();
    expect(findCardsSlug('/users/phaivroh')).toBeNull();
  });
});

describe('syncInventorySearch', () => {
  it('mounts open search input before poster control in toolbar', () => {
    syncInventorySearch(document, database);
    const control = findSearchControl();
    expect(control).not.toBeNull();
    expect(control?.classList.contains(`${SEARCH_CLASS}--open`)).toBe(true);
    expect(findSearchInput()?.placeholder).toBe('Имя персонажа...');
    expect(control?.nextElementSibling?.classList.contains('senkutools-poster__control')).toBe(true);
  });

  it('filters grid cards by character name and support ё/е equivalence', () => {
    syncInventorySearch(document, database);
    const input = findSearchInput()!;
    input.value = 'елка';
    input.dispatchEvent(new Event('input'));
    expect(visibleCards()).toHaveLength(1);
    expect(visibleCards()[0]?.dataset.id).toBe('ych-ёлка-s');
  });

  it('shows clear button when text typed, clicking it resets search', () => {
    syncInventorySearch(document, database);
    const input = findSearchInput()!;
    const clear = findClearButton()!;
    expect(clear.hidden).toBe(true);
    input.value = 'фели';
    input.dispatchEvent(new Event('input'));
    expect(clear.hidden).toBe(false);
    expect(visibleCards()).toHaveLength(1);
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(input.value).toBe('');
    expect(clear.hidden).toBe(true);
    expect(visibleCards()).toHaveLength(3);
  });

  it('resets query on Escape keydown', () => {
    syncInventorySearch(document, database);
    const input = findSearchInput()!;
    input.value = 'фели';
    input.dispatchEvent(new Event('input'));
    findSearchControl()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.value).toBe('');
    expect(visibleCards()).toHaveLength(3);
  });

  it('shows empty note when nothing matched', () => {
    syncInventorySearch(document, database);
    const input = findSearchInput()!;
    input.value = 'несуществующий';
    input.dispatchEvent(new Event('input'));
    expect(visibleCards()).toHaveLength(0);
    expect(findEmptyNote()?.textContent).toBe(EMPTY_SEARCH_TEXT);
  });

  it('does not mount when app is not mounted or page is not cards', () => {
    openPage('/users/phaivroh/cards', true, false);
    syncInventorySearch(document, database);
    expect(findSearchControl()).toBeNull();
    openPage('/users/phaivroh', true, true);
    syncInventorySearch(document, database);
    expect(findSearchControl()).toBeNull();
  });

  it('reports missing correctly', () => {
    expect(isInventorySearchMissing(document)).toBe(true);
    syncInventorySearch(document, database);
    expect(isInventorySearchMissing(document)).toBe(false);
  });
});
