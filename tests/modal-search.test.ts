import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../utils/shared/database';
import {
  EMPTY_SEARCH_TEXT,
  isHiddenBySearch,
  normalizeText,
  removeSearchControl,
  rowSearchText,
  SEARCH_TEXT,
  searchWordsOf,
  syncSearchControl,
  type SearchHost,
  type SearchView,
} from '../utils/trades/modal-search';

const database: Database = {
  'wh-felicity-f': { price: 1.5, name: 'Фелисити', rank: 'F', manga: 'Охотник на ведьм' },
  'ych-ёлка-s': { price: 9, name: 'Ёлка', rank: 'S', manga: 'Зимняя сказка' },
};

const cardRow = (slug: string, shownName: string | null, status = '') =>
  `<div class="card-collect-preview" data-id="${slug}">
    <div class="card-collect-preview__status">${status}</div>
    <div class="card-collect-preview__front">
      <a class="card-collect" href="/cards/${slug}"><div class="card-collect__front">${shownName === null ? '<video></video>' : `<img class="card-collect__img" alt="${shownName}">`}</div><span data-senkuro-price="1">9.99</span></a>
    </div>
    <div class="card-collect-preview__back"><a class="card-collect" href="/cards/${slug}"><div class="card-collect__front"><img class="card-collect__img" alt="Рубашка карты ${shownName}"></div></a></div>
  </div>`;

const rowOf = (html: string): Element => {
  document.body.innerHTML = html;
  return document.querySelector('.card-collect-preview') as Element;
};

const hides = (query: string, row: Element, source: Database = database) => isHiddenBySearch(searchWordsOf(query), row, source);

describe('normalizeText and searchWordsOf', () => {
  it('lowers the case and reads ё as е', () => {
    expect(normalizeText('ЁЛКА Ёж')).toBe('елка еж');
  });

  it('splits a query into its words, whatever the spaces around them', () => {
    expect(searchWordsOf('  Фелисити   ведьм ')).toEqual(['фелисити', 'ведьм']);
    expect(searchWordsOf('   ')).toEqual([]);
    expect(searchWordsOf('')).toEqual([]);
  });
});

describe('the text a row is searched by', () => {
  it('holds the name and the title from the database, the name the site shows and the words of the slug', () => {
    const text = rowSearchText(rowOf(cardRow('wh-felicity-f', 'Фелисити Эверт')), database);
    expect(text).toBe('фелисити охотник на ведьм фелисити эверт wh felicity f');
  });

  it('holds no quantity text, no price badge and no text of the back or the frame of the card', () => {
    const row = rowOf(cardRow('wh-felicity-f', 'Фелисити', '<span class="tag">3 карты</span>'));
    const text = rowSearchText(row, database);
    expect(text).not.toContain('карты');
    expect(text).not.toContain('9.99');
    expect(text).not.toContain('рубашка');
  });

  it('is built from the slug and the shown name alone for a card the database lacks', () => {
    expect(rowSearchText(rowOf(cardRow('new-card-x', 'Новая карта')), database)).toBe('новая карта new card x');
  });

  it('skips the shown name when the front draws no image, as an animated card does', () => {
    expect(rowSearchText(rowOf(cardRow('wh-felicity-f', null)), database)).toBe('фелисити охотник на ведьм wh felicity f');
  });

  it('is empty for a row with no card link', () => {
    expect(rowSearchText(rowOf('<div class="card-collect-preview"><span>3 карты</span></div>'), database)).toBe('');
  });
});

describe('what a query hides', () => {
  const felicity = () => rowOf(cardRow('wh-felicity-f', 'Фелисити'));

  it('hides nothing for an empty query', () => {
    expect(hides('', felicity())).toBe(false);
    expect(hides('   ', felicity())).toBe(false);
  });

  it.each([
    ['the name in the database', 'фелисити'],
    ['the title in the database', 'ведьм'],
    ['a part of a word', 'фелис'],
    ['the capital letters of the name', 'ФЕЛИСИТИ'],
    ['words from the name and the title together', 'охотник фелисити'],
    ['the words of the slug', 'felicity'],
  ])('keeps a row that matches by %s', (_name, query) => {
    expect(hides(query, felicity())).toBe(false);
  });

  it.each([
    ['a word that is nowhere in the row', 'наруто'],
    ['one word that matches and one that does not', 'фелисити наруто'],
    ['a word the row holds only as its quantity text', 'карты'],
  ])('hides a row for %s', (_name, query) => {
    expect(hides(query, rowOf(cardRow('wh-felicity-f', 'Фелисити', '<span class="tag">3 карты</span>')))).toBe(true);
  });

  it('finds ё and е as one letter in the row and in the query', () => {
    const elka = rowOf(cardRow('ych-ёлка-s', 'Ёлка'));
    expect(hides('елка', elka)).toBe(false);
    expect(hides('ёлка', rowOf(cardRow('x-elka-f', 'Елка')))).toBe(false);
  });

  it('matches by the name the site shows when the database holds another one or none', () => {
    expect(hides('чонхак', rowOf(cardRow('bl-revy-s', 'Тан Чонхак')))).toBe(false);
    expect(hides('чонхак', rowOf(cardRow('bl-revy-s', 'Дан Джонхак')))).toBe(true);
  });

  it('reads the database it is given at the time of the call, so a database that arrives later is used', () => {
    const row = rowOf(cardRow('wh-felicity-f', null));
    expect(hides('ведьм', row, {})).toBe(true);
    expect(hides('ведьм', row, database)).toBe(false);
  });
});

const toolbarHtml = (extra = '') => `<div class="modal-trade__header-form"><button id="sort">По дате получения</button>${extra}</div>`;

const toolbar = () => document.querySelector('.modal-trade__header-form') as HTMLElement;
const wrapper = () => document.querySelector<HTMLElement>('.senkutools-modal-search');
const trigger = () => document.querySelector<HTMLButtonElement>('.senkutools-modal-search__trigger');
const box = () => document.querySelector<HTMLElement>('.senkutools-modal-search__box');
const input = () => document.querySelector<HTMLInputElement>('.senkutools-modal-search__input');
const clearButton = () => document.querySelector<HTMLButtonElement>('.senkutools-modal-search__clear');
const closeButton = () => document.querySelector<HTMLButtonElement>('.senkutools-modal-search__close');

const draw = (initial: SearchView = { query: '', isOpen: false }) => {
  let view = initial;
  const queries: string[] = [];
  const toggles: boolean[] = [];
  const host: SearchHost = {
    change: (query) => {
      queries.push(query);
      view = { ...view, query };
      syncSearchControl(toolbar(), view, host);
    },
    toggle: (isOpen) => {
      toggles.push(isOpen);
      view = { ...view, isOpen };
      syncSearchControl(toolbar(), view, host);
    },
  };
  syncSearchControl(toolbar(), view, host);
  return { queries, toggles, view: () => view };
};

const type = (text: string) => {
  const field = input();
  if (!field) return;
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input()?.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  document.body.innerHTML = toolbarHtml();
});

describe('the search control', () => {
  it('stands last in the toolbar and shows only its icon button while it is closed', () => {
    draw();
    expect(toolbar().lastElementChild).toBe(wrapper());
    expect(trigger()?.className).toBe('button button--secondary button--icon button-size--md senkutools-modal-search__trigger');
    expect(trigger()?.title).toBe('Поиск персонажа');
    expect(trigger()?.getAttribute('aria-label')).toBe('Поиск персонажа');
    expect(trigger()?.hidden).toBe(false);
    expect(box()?.hidden).toBe(true);
    expect(wrapper()?.classList.contains('senkutools-modal-search--open')).toBe(false);
  });

  it('stands before the refresh button of the window', () => {
    document.body.innerHTML = toolbarHtml('<button class="button senkutools-modal-refresh"></button>');
    draw();
    expect(wrapper()?.nextElementSibling?.classList.contains('senkutools-modal-refresh')).toBe(true);
  });

  it('opens on the trigger and puts the focus into the field', () => {
    const { toggles } = draw();
    trigger()?.click();
    expect(toggles).toEqual([true]);
    expect(box()?.hidden).toBe(false);
    expect(trigger()?.hidden).toBe(true);
    expect(wrapper()?.classList.contains('senkutools-modal-search--open')).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it('names its field, its placeholder and its two buttons', () => {
    draw({ query: '', isOpen: true });
    expect(input()?.placeholder).toBe('Имя персонажа...');
    expect(input()?.getAttribute('aria-label')).toBe('Имя персонажа');
    expect(input()?.type).toBe('text');
    expect(clearButton()?.title).toBe('Очистить');
    expect(closeButton()?.title).toBe('Закрыть поиск');
    expect(SEARCH_TEXT.open).toBe('Поиск персонажа');
    expect(EMPTY_SEARCH_TEXT).toBe('Персонаж не найден');
  });

  it('draws an open view with its query and without taking the focus', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    draw({ query: 'ведьм', isOpen: true });
    expect(box()?.hidden).toBe(false);
    expect(input()?.value).toBe('ведьм');
    expect(clearButton()?.hidden).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it('reports every change of the text and shows the clear button only while there is text', () => {
    const { queries } = draw({ query: '', isOpen: true });
    expect(clearButton()?.hidden).toBe(true);
    type('Ф');
    type('Фе');
    expect(queries).toEqual(['Ф', 'Фе']);
    expect(clearButton()?.hidden).toBe(false);
    type('');
    expect(clearButton()?.hidden).toBe(true);
  });

  it('clears the text on the clear button and keeps the field open with the focus in it', () => {
    const { queries, toggles } = draw({ query: 'ведьм', isOpen: true });
    clearButton()?.click();
    expect(queries).toEqual(['']);
    expect(toggles).toEqual([]);
    expect(input()?.value).toBe('');
    expect(document.activeElement).toBe(input());
  });

  it('closes on the close button, clearing the text and giving the focus to the trigger', () => {
    const { queries, toggles, view } = draw({ query: 'ведьм', isOpen: true });
    closeButton()?.click();
    expect(queries).toEqual(['']);
    expect(toggles).toEqual([false]);
    expect(view()).toEqual({ query: '', isOpen: false });
    expect(box()?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('clears on the first Escape and closes on the second, and the window of the site, which closes on Escape, never hears either', () => {
    const { queries, toggles } = draw({ query: 'ведьм', isOpen: true });
    const reached = vi.fn();
    document.body.addEventListener('keydown', reached);
    const first = press('Escape');
    expect(queries).toEqual(['']);
    expect(toggles).toEqual([]);
    expect(first.defaultPrevented).toBe(true);
    const second = press('Escape');
    expect(toggles).toEqual([false]);
    expect(second.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger());
    expect(reached).not.toHaveBeenCalled();
  });

  it('treats Escape on the buttons of the open field like Escape in the field, and lets Escape through while the field is closed', () => {
    const { queries, toggles } = draw({ query: 'ведьм', isOpen: true });
    const reached = vi.fn();
    document.body.addEventListener('keydown', reached);
    const onButton = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    closeButton()?.dispatchEvent(onButton);
    expect(queries).toEqual(['']);
    expect(onButton.defaultPrevented).toBe(true);
    closeButton()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(toggles).toEqual([false]);
    const closed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    trigger()?.dispatchEvent(closed);
    expect(closed.defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledOnce();
  });

  it('lets every other key reach the window of the site untouched', () => {
    draw({ query: '', isOpen: true });
    const reached = vi.fn();
    document.body.addEventListener('keydown', reached);
    const event = press('a');
    expect(event.defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledOnce();
  });

  it('adds nothing to a toolbar it already stands in, however often it syncs', () => {
    draw({ query: 'ведьм', isOpen: true });
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const host: SearchHost = { change: vi.fn(), toggle: vi.fn() };
    syncSearchControl(toolbar(), { query: 'ведьм', isOpen: true }, host);
    syncSearchControl(toolbar(), { query: 'ведьм', isOpen: true }, host);
    expect(document.querySelectorAll('.senkutools-modal-search')).toHaveLength(1);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('is taken out with removeSearchControl and drawn again by the next sync', () => {
    draw({ query: 'ведьм', isOpen: true });
    removeSearchControl(toolbar());
    expect(wrapper()).toBeNull();
    draw();
    expect(wrapper()).not.toBeNull();
    expect(input()?.value).toBe('');
  });
});
