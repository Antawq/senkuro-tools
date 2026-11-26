import { isAppMounted } from '../shared/app-mounted';
import { isHiddenBySearch, searchWordsOf } from '../shared/card-search';
import { CARD_ROW_CLASS } from '../shared/cards';
import type { Database } from '../shared/database';
import { childWithClass, element, writeAttribute } from '../shared/dom';
import { isListComplete, retriggerPaging } from '../shared/paging-sentinel';
import { closeIcon, searchIcon } from '../shared/svg';
import { createToolbarControls, type ToolbarControl } from '../shared/toolbar-controls';
import { DECK_RESULTS, DECK_TOOLBAR, USER_CARD_FILTERS } from '../shared/user-card-filters';
import { extractProfileSlug } from './profile-cards';

export const SEARCH_CLASS = 'senkutools-modal-search';
const BOX_CLASS = `${SEARCH_CLASS}__box`;
const INPUT_CLASS = `${SEARCH_CLASS}__input`;
const CLOSE_CLASS = `${SEARCH_CLASS}__close`;
const CLEAR_CLASS = `${SEARCH_CLASS}__clear`;
const OPEN_CLASS = `${SEARCH_CLASS}--open`;
const EMPTY_CLASS = `${SEARCH_CLASS}__empty`;
const FILTERED_ATTRIBUTE = 'data-senkutools-filtered';
const GRID = '.user-cards-grid';
const POSTER_CONTROL = '.senkutools-poster__control';
const ICON_SIZE_PX = 16;
export const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
export const EMPTY_SEARCH_TEXT = 'Персонаж не найден';

interface InventorySearchControl extends ToolbarControl {
  input: HTMLInputElement;
  clear: HTMLButtonElement;
}

interface SearchPlace {
  keyOf: (pageDocument: Document) => string | null;
  toolbar: string;
  grid: string;
  laterControls: readonly string[];
}

interface SearchState {
  key: string | null;
  query: string;
  toolbar: Element | null;
}

const controls = createToolbarControls<InventorySearchControl>();

export const findCardsSlug = (pathname: string): string | null => (CARDS_PATH.test(pathname) ? extractProfileSlug(pathname) : null);

const pathnameOf = (pageDocument: Document): string => pageDocument.defaultView?.location.pathname ?? pageDocument.location?.pathname ?? '';

const SEARCH_PLACES: readonly SearchPlace[] = [
  { keyOf: (pageDocument) => findCardsSlug(pathnameOf(pageDocument)), toolbar: USER_CARD_FILTERS, grid: GRID, laterControls: [POSTER_CONTROL] },
  {
    keyOf: (pageDocument) => (pageDocument.querySelector(DECK_RESULTS) ? pathnameOf(pageDocument) : null),
    toolbar: DECK_TOOLBAR,
    grid: DECK_RESULTS,
    laterControls: [],
  },
];

const searchStates = new Map<SearchPlace, SearchState>(SEARCH_PLACES.map((place) => [place, { key: null, query: '', toolbar: null }]));

function syncEmptyNote(grid: HTMLElement, text: string | null): void {
  const note = childWithClass(grid.parentElement ?? grid, EMPTY_CLASS);
  if (!text) return note?.remove();
  if (note) {
    if (note.textContent !== text) note.textContent = text;
    return;
  }
  grid.after(element('div', EMPTY_CLASS, text));
}

function syncRows(grid: HTMLElement, query: string, database: Database): void {
  const words = searchWordsOf(query);
  const rows = [...grid.querySelectorAll<HTMLElement>(`:scope > .${CARD_ROW_CLASS}`)];
  for (const row of rows) writeAttribute(row, FILTERED_ATTRIBUTE, isHiddenBySearch(words, row, database) ? '' : null);
  const isFiltered = (row: Element) => row.hasAttribute(FILTERED_ATTRIBUTE);
  const allFiltered = rows.length > 0 && rows.every(isFiltered) && isListComplete(grid);
  syncEmptyNote(grid, allFiltered ? EMPTY_SEARCH_TEXT : null);
  if (words.length > 0) retriggerPaging(grid);
}

function clearFiltering(grid: HTMLElement | null): void {
  if (!grid) return;
  for (const row of grid.querySelectorAll<HTMLElement>(`:scope > [${FILTERED_ATTRIBUTE}]`)) row.removeAttribute(FILTERED_ATTRIBUTE);
  childWithClass(grid.parentElement ?? grid, EMPTY_CLASS)?.remove();
}

function createControl(onQueryChange: (query: string) => void): InventorySearchControl {
  const wrapper = element('div', `${SEARCH_CLASS} ${OPEN_CLASS}`);
  const box = element('div', BOX_CLASS);
  const icon = element('span', CLOSE_CLASS);
  icon.setAttribute('aria-hidden', 'true');
  icon.append(searchIcon(ICON_SIZE_PX));
  const input = element('input', INPUT_CLASS);
  input.type = 'text';
  input.placeholder = 'Имя персонажа...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Имя персонажа');
  const clear = element('button', CLEAR_CLASS);
  clear.type = 'button';
  clear.title = 'Очистить';
  clear.setAttribute('aria-label', 'Очистить');
  clear.hidden = true;
  clear.append(closeIcon(ICON_SIZE_PX));

  const reset = () => {
    input.value = '';
    clear.hidden = true;
    onQueryChange('');
    input.focus();
  };
  clear.addEventListener('click', (event) => {
    event.preventDefault();
    reset();
  });
  input.addEventListener('input', () => {
    clear.hidden = input.value === '';
    onQueryChange(input.value);
  });
  wrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value !== '') {
      event.preventDefault();
      event.stopPropagation();
      reset();
    }
  });
  box.append(icon, input, clear);
  wrapper.append(box);
  return { wrapper, input, clear };
}

const resetState = (state: SearchState): void => {
  state.key = null;
  state.query = '';
  state.toolbar = null;
};

export function resetInventorySearchState(): void {
  for (const state of searchStates.values()) resetState(state);
}

function syncPlace(place: SearchPlace, state: SearchState, pageDocument: Document, database: Database): void {
  const key = place.keyOf(pageDocument);
  const toolbar = pageDocument.querySelector(place.toolbar);
  const grid = pageDocument.querySelector<HTMLElement>(place.grid);
  if (!key || !toolbar || !isAppMounted(pageDocument)) {
    if (state.toolbar) controls.remove(state.toolbar);
    clearFiltering(grid);
    resetState(state);
    return;
  }
  if (state.key !== key) {
    if (state.toolbar && state.toolbar !== toolbar) controls.remove(state.toolbar);
    state.key = key;
    state.query = '';
  }
  const control = controls.place(
    toolbar,
    () =>
      createControl((nextQuery) => {
        state.query = nextQuery;
        const currentGrid = pageDocument.querySelector<HTMLElement>(place.grid);
        if (currentGrid) syncRows(currentGrid, state.query, database);
      }),
    place.laterControls
  );
  for (const duplicate of toolbar.querySelectorAll<HTMLElement>(`:scope > .${SEARCH_CLASS}`)) {
    if (duplicate !== control.wrapper) duplicate.remove();
  }
  state.toolbar = toolbar;
  if (control.input.value !== state.query) {
    control.input.value = state.query;
    control.clear.hidden = state.query === '';
  }
  if (grid) syncRows(grid, state.query, database);
}

export function syncInventorySearch(pageDocument: Document, database: Database): void {
  for (const [place, state] of searchStates) syncPlace(place, state, pageDocument, database);
}

export function isInventorySearchMissing(pageDocument: Document): boolean {
  if (!isAppMounted(pageDocument)) return false;
  return SEARCH_PLACES.some((place) => {
    const toolbar = pageDocument.querySelector(place.toolbar);
    return Boolean(place.keyOf(pageDocument) && toolbar && toolbar.querySelector(`:scope > .${SEARCH_CLASS}`) === null);
  });
}
