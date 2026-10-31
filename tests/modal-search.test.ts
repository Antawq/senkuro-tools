import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../utils/shared/database';
import {
  EMPTY_SEARCH_NOTE_CLASS,
  EMPTY_SEARCH_TEXT,
  MODAL_SEARCH_BTN_CLASS,
  MODAL_SEARCH_CLEAR_CLASS,
  MODAL_SEARCH_INPUT_CLASS,
  MODAL_SEARCH_OPEN_CLASS,
  SEARCH_ACTIVE_ATTR,
  SEARCH_HIDDEN_ATTR,
  createModalSearch,
  getCardSearchText,
  isSearchMutation,
  markSearchCards,
  matchCard,
  normalizeQuery,
  syncModalSearch,
  syncPickerSearch,
} from '../utils/trades/modal-search';

const mockDb: Database = {
  'sce-lloyd-frontera-r': { price: 1.25, name: 'Ллойд Фронтера', rank: 'R', manga: 'Система всемогущего дизайнера' },
  'sce-artoria-pendragon-s': { price: 2.5, name: 'Артурия Пендрагон', rank: 'S', manga: 'Судьба: Ночь схватки' },
  'sce-naruto-uzumaki-a': { price: 0.8, name: 'Наруто Узумаки', rank: 'A', manga: 'Наруто' },
};

const cardHtml = (slug: string, alt: string = '') =>
  `<div class="card-collect-preview modal-trade__card"><div class="card-collect-preview__front"><a class="card-collect" href="/cards/${slug}"><img alt="${alt}"></a></div></div>`;

const tradeModalHtml = (cards: string[], hasToolbar = true, isCatalog = false) => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header">
      <h4>${isCatalog ? 'Выбор карт из общего каталога' : 'Выбери карты'}</h4>
    </header>
    <div class="modal-trade__body">
      ${hasToolbar ? '<div class="modal-trade__header-form"><div class="senkutools-modal-lock-popper"></div><button class="senkutools-modal-refresh"></button></div>' : ''}
      <div class="modal-trade__body-result">${cards.join('')}</div>
    </div>
  </div>
`;

describe('normalizeQuery', () => {
  it('converts to lowercase, trims, and replaces ё with е', () => {
    expect(normalizeQuery('  ЛлОйД ФрОнТеРа  ')).toBe('ллойд фронтера');
    expect(normalizeQuery('Сёгун Фёдор')).toBe('сегун федор');
  });
});

describe('getCardSearchText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('combines database character name, manga, and slug', () => {
    document.body.innerHTML = cardHtml('sce-lloyd-frontera-r');
    const card = document.querySelector('.card-collect-preview') as HTMLElement;
    const text = getCardSearchText(card, mockDb);
    expect(text).toContain('ллойд фронтера');
    expect(text).toContain('система всемогущего дизайнера');
    expect(text).toContain('lloyd frontera');
  });

  it('uses img alt or textContent if database does not know the card', () => {
    document.body.innerHTML = cardHtml('unknown-card-slug', 'Неизвестный Персонаж');
    const card = document.querySelector('.card-collect-preview') as HTMLElement;
    const text = getCardSearchText(card, mockDb);
    expect(text).toContain('неизвестный персонаж');
    expect(text).toContain('unknown card slug');
  });
});

describe('matchCard', () => {
  it('matches Russian character name, Latin slug, or manga title', () => {
    document.body.innerHTML = cardHtml('sce-lloyd-frontera-r');
    const card = document.querySelector('.card-collect-preview') as HTMLElement;
    expect(matchCard(card, mockDb, 'ллойд')).toBe(true);
    expect(matchCard(card, mockDb, 'lloyd')).toBe(true);
    expect(matchCard(card, mockDb, 'дизайнер')).toBe(true);
    expect(matchCard(card, mockDb, 'артурия')).toBe(false);
  });

  it('supports multi-word query tokens', () => {
    document.body.innerHTML = cardHtml('sce-lloyd-frontera-r');
    const card = document.querySelector('.card-collect-preview') as HTMLElement;
    expect(matchCard(card, mockDb, 'ллойд фронт')).toBe(true);
    expect(matchCard(card, mockDb, 'lloyd r')).toBe(true);
    expect(matchCard(card, mockDb, 'ллойд наруто')).toBe(false);
  });

  it('matches everything on empty query', () => {
    document.body.innerHTML = cardHtml('sce-lloyd-frontera-r');
    const card = document.querySelector('.card-collect-preview') as HTMLElement;
    expect(matchCard(card, mockDb, '')).toBe(true);
    expect(matchCard(card, mockDb, '   ')).toBe(true);
  });
});

describe('markSearchCards', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="modal-trade__body-result">
        ${cardHtml('sce-lloyd-frontera-r')}
        ${cardHtml('sce-artoria-pendragon-s')}
        ${cardHtml('sce-naruto-uzumaki-a')}
      </div>
    `;
  });

  it('marks non-matching cards with data-senkutools-search-hidden=true and returns match count', () => {
    const results = document.querySelector('.modal-trade__body-result') as HTMLElement;
    const count = markSearchCards(results, mockDb, 'артурия');
    expect(count).toBe(1);
    const [c1, c2, c3] = [...results.querySelectorAll('.card-collect-preview')];
    expect(c1!.getAttribute(SEARCH_HIDDEN_ATTR)).toBe('true');
    expect(c2!.getAttribute(SEARCH_HIDDEN_ATTR)).toBe('false');
    expect(c3!.getAttribute(SEARCH_HIDDEN_ATTR)).toBe('true');
  });

  it('removes search hidden attribute when query is empty', () => {
    const results = document.querySelector('.modal-trade__body-result') as HTMLElement;
    markSearchCards(results, mockDb, 'артурия');
    markSearchCards(results, mockDb, '');
    const cards = results.querySelectorAll('.card-collect-preview');
    for (const card of cards) {
      expect(card.hasAttribute(SEARCH_HIDDEN_ATTR)).toBe(false);
    }
  });
});

describe('createModalSearch UI component', () => {
  it('creates collapsed search button by default', () => {
    const onQueryChange = vi.fn();
    const component = createModalSearch('', false, onQueryChange);
    expect(component.classList.contains(MODAL_SEARCH_OPEN_CLASS)).toBe(false);
    const btn = component.querySelector(`.${MODAL_SEARCH_BTN_CLASS}`) as HTMLElement;
    expect(btn).not.toBeNull();
    const input = component.querySelector(`.${MODAL_SEARCH_INPUT_CLASS}`) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('expands when button is clicked and focuses input', () => {
    const onQueryChange = vi.fn();
    const component = createModalSearch('', false, onQueryChange);
    document.body.append(component);
    const btn = component.querySelector(`.${MODAL_SEARCH_BTN_CLASS}`) as HTMLButtonElement;
    btn.click();
    expect(component.classList.contains(MODAL_SEARCH_OPEN_CLASS)).toBe(true);
    component.remove();
  });

  it('fires onQueryChange and shows clear button on input', () => {
    const onQueryChange = vi.fn();
    const component = createModalSearch('', true, onQueryChange);
    const input = component.querySelector(`.${MODAL_SEARCH_INPUT_CLASS}`) as HTMLInputElement;
    const clearBtn = component.querySelector(`.${MODAL_SEARCH_CLEAR_CLASS}`) as HTMLButtonElement;
    expect(clearBtn.hidden).toBe(true);

    input.value = 'наруто';
    input.dispatchEvent(new Event('input'));
    expect(onQueryChange).toHaveBeenCalledWith('наруто');
    expect(clearBtn.hidden).toBe(false);
  });

  it('clears query and re-focuses input when clear button is clicked', () => {
    const onQueryChange = vi.fn();
    const component = createModalSearch('наруто', true, onQueryChange);
    document.body.append(component);
    const input = component.querySelector(`.${MODAL_SEARCH_INPUT_CLASS}`) as HTMLInputElement;
    const clearBtn = component.querySelector(`.${MODAL_SEARCH_CLEAR_CLASS}`) as HTMLButtonElement;
    clearBtn.click();
    expect(input.value).toBe('');
    expect(clearBtn.hidden).toBe(true);
    expect(onQueryChange).toHaveBeenCalledWith('');
    component.remove();
  });

  it('handles Escape key: clears query first, then collapses on next Escape', () => {
    const onQueryChange = vi.fn();
    const component = createModalSearch('наруто', true, onQueryChange);
    document.body.append(component);
    const input = component.querySelector(`.${MODAL_SEARCH_INPUT_CLASS}`) as HTMLInputElement;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(input.value).toBe('');
    expect(onQueryChange).toHaveBeenCalledWith('');
    expect(component.classList.contains(MODAL_SEARCH_OPEN_CLASS)).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.classList.contains(MODAL_SEARCH_OPEN_CLASS)).toBe(false);
    component.remove();
  });
});

describe('syncModalSearch toolbar positioning and picker filtering', () => {
  beforeEach(() => {
    document.body.innerHTML = tradeModalHtml([
      cardHtml('sce-lloyd-frontera-r'),
      cardHtml('sce-artoria-pendragon-s'),
    ]);
  });

  it('places search button before lock popper and refresh button in toolbar', () => {
    syncModalSearch(document, mockDb);
    const toolbar = document.querySelector('.modal-trade__header-form') as HTMLElement;
    const search = toolbar.querySelector('.senkutools-modal-search') as HTMLElement;
    const lockPopper = toolbar.querySelector('.senkutools-modal-lock-popper') as HTMLElement;
    const refreshBtn = toolbar.querySelector('.senkutools-modal-refresh') as HTMLElement;

    expect(search).not.toBeNull();
    expect(search.nextElementSibling).toBe(lockPopper);
    expect(lockPopper.nextElementSibling).toBe(refreshBtn);
  });

  it('removes search when modal switches to catalog step', () => {
    syncModalSearch(document, mockDb);
    expect(document.querySelector('.senkutools-modal-search')).not.toBeNull();

    (document.querySelector('.modal-trade__header h4') as HTMLElement).textContent = 'Выбор карт из общего каталога';
    syncModalSearch(document, mockDb);
    expect(document.querySelector('.senkutools-modal-search')).toBeNull();
  });

  it('shows empty note when no cards match the character name', () => {
    syncModalSearch(document, mockDb);
    const modal = document.querySelector('.modal-content--trade') as HTMLElement;
    const picker = modal.querySelector('.modal-trade__body') as HTMLElement;

    const input = modal.querySelector(`.${MODAL_SEARCH_INPUT_CLASS}`) as HTMLInputElement;
    input.value = 'несуществующий';
    input.dispatchEvent(new Event('input'));

    expect(picker.getAttribute(SEARCH_ACTIVE_ATTR)).toBe('true');
    const emptyNote = picker.querySelector(`.${EMPTY_SEARCH_NOTE_CLASS}`) as HTMLElement;
    expect(emptyNote).not.toBeNull();
    expect(emptyNote.textContent).toBe(EMPTY_SEARCH_TEXT);
  });
});

describe('isSearchMutation filter', () => {
  it('ignores mutations inside own search nodes', () => {
    const searchRoot = document.createElement('div');
    searchRoot.className = 'senkutools-modal-search';
    const input = document.createElement('input');
    input.className = 'senkutools-modal-search__input';
    searchRoot.append(input);

    const mutation: MutationRecord = {
      type: 'childList',
      target: searchRoot,
      addedNodes: [input] as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    };

    expect(isSearchMutation(mutation)).toBe(false);
  });
});
