import { isAppMounted } from '../shared/app-mounted';
import { isHiddenBySearch, searchWordsOf } from '../shared/card-search';
import { CARD_ROW_CLASS } from '../shared/cards';
import type { Database } from '../shared/database';
import { childWithClass, element, writeAttribute } from '../shared/dom';
import { isListComplete, retriggerPaging } from '../shared/paging-sentinel';
import { closeIcon, searchIcon } from '../shared/svg';
import { createToolbarControls, type ToolbarControl } from '../shared/toolbar-controls';
import { USER_CARD_FILTERS } from '../shared/user-card-filters';
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
const LATER_CONTROLS = [POSTER_CONTROL];
const ICON_SIZE_PX = 16;
export const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
export const EMPTY_SEARCH_TEXT = 'Персонаж не найден';

interface InventorySearchControl extends ToolbarControl {
  input: HTMLInputElement;
  clear: HTMLButtonElement;
  slug: string;
}

const controls = createToolbarControls<InventorySearchControl>();
let activeSlug: string | null = null;
let activeQuery = '';
let activeToolbar: Element | null = null;

export const findCardsSlug = (pathname: string): string | null => (CARDS_PATH.test(pathname) ? extractProfileSlug(pathname) : null);

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

function createControl(slug: string, onQueryChange: (query: string) => void): InventorySearchControl {
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
  clear.addEventListener('click', (e) => {
    e.preventDefault();
    reset();
  });
  input.addEventListener('input', () => {
    clear.hidden = input.value === '';
    onQueryChange(input.value);
  });
  wrapper.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value !== '') {
      e.preventDefault();
      e.stopPropagation();
      reset();
    }
  });
  box.append(icon, input, clear);
  wrapper.append(box);
  return { wrapper, input, clear, slug };
}

export function resetInventorySearchState(): void {
  activeSlug = null;
  activeQuery = '';
  activeToolbar = null;
}

export function syncInventorySearch(pageDocument: Document, database: Database): void {
  const pathname = pageDocument.defaultView?.location.pathname ?? pageDocument.location?.pathname ?? '';
  const slug = findCardsSlug(pathname);
  const toolbar = pageDocument.querySelector(USER_CARD_FILTERS);
  const grid = pageDocument.querySelector<HTMLElement>(GRID);
  if (!slug || !toolbar || !isAppMounted(pageDocument)) {
    if (activeToolbar) controls.remove(activeToolbar);
    clearFiltering(grid);
    resetInventorySearchState();
    return;
  }
  if (activeSlug !== slug) {
    if (activeToolbar && activeToolbar !== toolbar) controls.remove(activeToolbar);
    activeSlug = slug;
    activeQuery = '';
  }
  const control = controls.place(
    toolbar,
    () =>
      createControl(slug, (nextQuery) => {
        activeQuery = nextQuery;
        const currentGrid = pageDocument.querySelector<HTMLElement>(GRID);
        if (currentGrid) syncRows(currentGrid, activeQuery, database);
      }),
    LATER_CONTROLS
  );
  for (const duplicate of toolbar.querySelectorAll<HTMLElement>(`:scope > .${SEARCH_CLASS}`)) {
    if (duplicate !== control.wrapper) duplicate.remove();
  }
  activeToolbar = toolbar;
  if (control.input.value !== activeQuery) {
    control.input.value = activeQuery;
    control.clear.hidden = activeQuery === '';
  }
  if (grid) syncRows(grid, activeQuery, database);
}

export function isInventorySearchMissing(pageDocument: Document): boolean {
  const pathname = pageDocument.defaultView?.location.pathname ?? pageDocument.location?.pathname ?? '';
  const slug = findCardsSlug(pathname);
  const toolbar = pageDocument.querySelector(USER_CARD_FILTERS);
  return Boolean(slug && toolbar && isAppMounted(pageDocument) && toolbar.querySelector(`:scope > .${SEARCH_CLASS}`) === null);
}
