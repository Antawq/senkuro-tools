import { afterEach, describe, expect, it, vi } from 'vitest';

import { CARD_SEARCH_CLASS, CARD_SEARCH_TEXT, suggestCharacters, syncCardCatalogSearch, type CardSearchHost } from '../utils/catalog/card-catalog-search';
import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';
import type { Database } from '../utils/shared/database';

const database: Database = {
  'hnr-winry-rockbell-s': { price: 3, name: 'Уинри Рокбелл', rank: 'S', manga: 'Стальной алхимик' },
  'hnr-winry-rockbell-a': { price: 2, name: 'Уинри Рокбелл', rank: 'A', manga: 'Стальной алхимик' },
  'nar-sasuke-a': { price: 5, name: 'Саске Учиха', rank: 'A', manga: 'Наруто' },
  'ych-ёлка-s': { price: 9, name: 'Ёлка', rank: 'S', manga: 'Зимняя сказка' },
  'no-name-f': { price: 1, name: '', rank: 'F' },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const openCatalog = (path = '/browse/cards') => {
  window.history.pushState({}, '', path);
  document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
  document.body.innerHTML = '<div class="catalog-cnt"><div class="catalog-cnt__nav"></div><div class="catalog-cnt__result"></div></div>';
};

const hostOf = (characterId: string | null | Error = 'Q0hBUkFDVEVSOjE') => {
  const findCharacterId = vi.fn<CardSearchHost['findCharacterId']>(() =>
    characterId instanceof Error ? Promise.reject(characterId) : Promise.resolve(characterId)
  );
  const applyCharacter = vi.fn<CardSearchHost['applyCharacter']>();
  return { findCharacterId, applyCharacter };
};

const type = (text: string) => {
  const input = document.querySelector<HTMLInputElement>(`.${CARD_SEARCH_CLASS} input`) as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return input;
};

const options = () => [...document.querySelectorAll<HTMLButtonElement>(`.${CARD_SEARCH_CLASS}__option`)];

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);
});

describe('before the app is mounted', () => {
  it('draws nothing, so the site hydration cannot adopt the search', () => {
    openCatalog();
    document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);
    syncCardCatalogSearch(document, database, hostOf());
    expect(document.querySelector(`.${CARD_SEARCH_CLASS}`)).toBeNull();
  });
});

describe('suggestCharacters', () => {
  it('finds a character by its Russian name, by the Latin words of its slug and with ё typed as е', () => {
    expect(suggestCharacters(database, 'уинри').map((suggestion) => suggestion.name)).toEqual(['Уинри Рокбелл']);
    expect(suggestCharacters(database, 'winry').map((suggestion) => suggestion.name)).toEqual(['Уинри Рокбелл']);
    expect(suggestCharacters(database, 'елка')).toEqual([{ slug: 'ych-ёлка-s', name: 'Ёлка', title: 'Зимняя сказка' }]);
  });

  it('lists a character once whatever its number of ranks, matches the title too and ignores cards without a name', () => {
    expect(suggestCharacters(database, 'алхимик')).toEqual([{ slug: 'hnr-winry-rockbell-s', name: 'Уинри Рокбелл', title: 'Стальной алхимик' }]);
    expect(suggestCharacters(database, 'no name')).toEqual([]);
    expect(suggestCharacters(database, '  ')).toEqual([]);
  });
});

describe('syncCardCatalogSearch', () => {
  it('puts the search under the sort row of the card catalog only', () => {
    openCatalog();
    syncCardCatalogSearch(document, database, hostOf());
    expect(document.querySelector('.catalog-cnt__nav')?.nextElementSibling?.classList.contains(CARD_SEARCH_CLASS)).toBe(true);
    openCatalog('/browse/manga');
    syncCardCatalogSearch(document, database, hostOf());
    expect(document.querySelector(`.${CARD_SEARCH_CLASS}`)).toBeNull();
  });

  it('filters the catalog by the picked character through the site filter', async () => {
    openCatalog();
    const host = hostOf('Q0hBUkFDVEVSOjE4');
    syncCardCatalogSearch(document, database, host);
    const input = type('уинри');
    expect(options().map((option) => option.textContent)).toEqual(['Уинри РокбеллСтальной алхимик']);
    options()[0]?.click();
    await settle();
    expect(host.findCharacterId).toHaveBeenCalledWith('hnr-winry-rockbell-s');
    expect(host.applyCharacter).toHaveBeenCalledWith('Q0hBUkFDVEVSOjE4');
    expect(input.value).toBe('Уинри Рокбелл');
  });

  it('picks the first suggestion on Enter', async () => {
    openCatalog();
    const host = hostOf();
    syncCardCatalogSearch(document, database, host);
    const input = type('саске');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(host.findCharacterId).toHaveBeenCalledWith('nar-sasuke-a');
  });

  it('says so when nothing matches or the character cannot be found', async () => {
    openCatalog();
    syncCardCatalogSearch(document, database, hostOf(new Error('network')));
    type('несуществующий');
    expect(document.querySelector(`.${CARD_SEARCH_CLASS}__note`)?.textContent).toBe(CARD_SEARCH_TEXT.nothing);
    type('ёлка');
    options()[0]?.click();
    await settle();
    expect(document.querySelector(`.${CARD_SEARCH_CLASS}__note`)?.textContent).toBe(CARD_SEARCH_TEXT.failed);
  });
});
