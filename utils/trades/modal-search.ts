import type { Database } from '../shared/database';
import { element } from '../shared/dom';
import { slugFromHref } from '../shared/cards';
import { closeIcon, searchIcon } from '../shared/svg';
import { MODAL_LOCK_POPPER_CLASS } from './lock-filter';
import { MODAL_REFRESH_CLASS } from './modal-refresh';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';
import { CATALOG_STEP, HEADER, MODAL, RESULTS_CLASS } from './trade-modal';

export const MODAL_SEARCH_CLASS = 'senkutools-modal-search';
export const MODAL_SEARCH_BTN_CLASS = 'senkutools-modal-search-btn';
export const MODAL_SEARCH_BOX_CLASS = 'senkutools-modal-search__box';
export const MODAL_SEARCH_INPUT_CLASS = 'senkutools-modal-search__input';
export const MODAL_SEARCH_CLEAR_CLASS = 'senkutools-modal-search__clear';
export const MODAL_SEARCH_ICON_CLASS = 'senkutools-modal-search__icon';
export const MODAL_SEARCH_OPEN_CLASS = 'senkutools-modal-search--open';
export const EMPTY_SEARCH_NOTE_CLASS = 'senkutools-search-empty';

export const SEARCH_ACTIVE_ATTR = 'data-senkutools-search-active';
export const SEARCH_HIDDEN_ATTR = 'data-senkutools-search-hidden';
export const EMPTY_SEARCH_TEXT = 'Персонаж не найден';

const TOOLBAR = '.modal-trade__header-form';
const PICKER = '.modal-trade__body';
const RESULTS = `.${RESULTS_CLASS}`;
const ROW = 'card-collect-preview';
const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const ICON_SIZE_PX = 20;
const SMALL_ICON_SIZE_PX = 16;
const PAGING_MARGIN_PX = 250;
const PARKED_ATTRIBUTE = 'data-senkutools-paging-parked';
const PARKED_FRAMES = 2;

const OWN_NODES = `.${MODAL_SEARCH_CLASS}, .${MODAL_SEARCH_BTN_CLASS}, .${MODAL_SEARCH_BOX_CLASS}, .${MODAL_SEARCH_INPUT_CLASS}, .${MODAL_SEARCH_CLEAR_CLASS}, .${EMPTY_SEARCH_NOTE_CLASS}`;

const queriesByModal = new WeakMap<Element, string>();
const openStatesByModal = new WeakMap<Element, boolean>();
const parkedStates = new WeakMap<Element, string>();

export interface ModalSearchHost {
  nextFrame: (run: () => void) => void;
}

const childWithClass = (parent: Element, className: string): HTMLElement | undefined =>
  [...parent.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(className));

const isUserCardsStep = (modal: Element): boolean =>
  modal.querySelector(RESULTS) !== null && !(modal.querySelector(HEADER)?.textContent ?? '').includes(CATALOG_STEP);

export const normalizeQuery = (text: string): string => text.toLowerCase().trim().replace(/ё/g, 'е');

export function getCardSearchText(card: Element, database: Database): string {
  const link = card.querySelector<HTMLAnchorElement>('a.card-collect');
  const slug = slugFromHref(link?.getAttribute('href'));
  const entry = slug ? database[slug] : undefined;

  const parts: string[] = [];
  if (entry?.name) parts.push(entry.name);
  if (entry?.manga) parts.push(entry.manga);
  if (slug) {
    parts.push(slug);
    parts.push(slug.replace(/-/g, ' '));
  }

  const img = card.querySelector('img');
  if (img?.alt) parts.push(img.alt);
  if (img?.title) parts.push(img.title);
  if (link?.title) parts.push(link.title);

  const text = card.textContent?.trim();
  if (text) parts.push(text);

  return normalizeQuery(parts.join(' '));
}

export function matchCard(card: Element, database: Database, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const cardText = getCardSearchText(card, database);
  return tokens.every((token) => cardText.includes(token));
}

export function markSearchCards(results: Element, database: Database, query: string): number {
  const cards = results.querySelectorAll<HTMLElement>(`.${ROW}, .modal-trade__card`);
  const normalized = normalizeQuery(query);
  if (!normalized) {
    for (const card of cards) {
      card.removeAttribute(SEARCH_HIDDEN_ATTR);
    }
    return cards.length;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let matchCount = 0;

  for (const card of cards) {
    const cardText = getCardSearchText(card, database);
    const matches = tokens.every((token) => cardText.includes(token));
    card.setAttribute(SEARCH_HIDDEN_ATTR, String(!matches));
    if (matches) matchCount++;
  }

  return matchCount;
}

const findSentinel = (results: Element): HTMLElement | undefined =>
  [...results.children].find((child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains(ROW));

const waitFrames = (count: number, run: () => void) => {
  if (count <= 0) run();
  else requestAnimationFrame(() => waitFrames(count - 1, run));
};

const retriggerPaging = (results: Element, picker: Element, isSearching: boolean) => {
  const sentinel = findSentinel(results);
  if (!isSearching || !sentinel) return;
  const state = `search:${results.querySelectorAll(`.${ROW}`).length}`;
  if (parkedStates.get(results) === state) return;
  if (sentinel.getBoundingClientRect().top > picker.getBoundingClientRect().bottom + PAGING_MARGIN_PX) return;
  parkedStates.set(results, state);
  sentinel.setAttribute(PARKED_ATTRIBUTE, '');
  waitFrames(PARKED_FRAMES, () => sentinel.removeAttribute(PARKED_ATTRIBUTE));
};

const emptyTextOf = (results: Element, query: string, matchCount: number): string | null => {
  if (!normalizeQuery(query)) return null;
  const cards = [...results.querySelectorAll<HTMLElement>(`.${ROW}, .modal-trade__card`)];
  const hasMorePages = [...results.children].some((child) => !child.classList.contains(ROW));
  if (cards.length === 0 || hasMorePages) return null;
  return matchCount === 0 ? EMPTY_SEARCH_TEXT : null;
};

const syncEmptyNote = (picker: HTMLElement, text: string | null) => {
  const note = childWithClass(picker, EMPTY_SEARCH_NOTE_CLASS);
  if (text === null) note?.remove();
  else if (note) note.textContent = text;
  else picker.append(element('div', EMPTY_SEARCH_NOTE_CLASS, text));
};

export function createModalSearch(
  initialQuery: string = '',
  initialOpen: boolean = false,
  onQueryChange: (query: string) => void,
  onToggleOpen?: (open: boolean) => void
): HTMLElement {
  const root = element('div', MODAL_SEARCH_CLASS);

  const button = element('button', `${SITE_BUTTON} ${MODAL_SEARCH_BTN_CLASS}`) as HTMLButtonElement;
  button.type = 'button';
  button.title = 'Поиск персонажа';
  button.setAttribute('aria-label', 'Поиск персонажа');
  const btnIcon = searchIcon(ICON_SIZE_PX);
  btnIcon.setAttribute('aria-hidden', 'true');
  button.append(btnIcon);

  const box = element('div', MODAL_SEARCH_BOX_CLASS);

  const iconWrap = element('span', MODAL_SEARCH_ICON_CLASS);
  iconWrap.title = 'Закрыть поиск';
  const inlineIcon = searchIcon(SMALL_ICON_SIZE_PX);
  inlineIcon.setAttribute('aria-hidden', 'true');
  iconWrap.append(inlineIcon);

  const input = element('input', MODAL_SEARCH_INPUT_CLASS) as HTMLInputElement;
  input.type = 'text';
  input.placeholder = 'Имя персонажа...';
  input.setAttribute('aria-label', 'Имя персонажа');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = initialQuery;

  const clearBtn = element('button', MODAL_SEARCH_CLEAR_CLASS) as HTMLButtonElement;
  clearBtn.type = 'button';
  clearBtn.title = 'Очистить';
  clearBtn.setAttribute('aria-label', 'Очистить');
  clearBtn.hidden = !initialQuery;
  const clearSvg = closeIcon(SMALL_ICON_SIZE_PX);
  clearSvg.setAttribute('aria-hidden', 'true');
  clearBtn.append(clearSvg);

  box.append(iconWrap, input, clearBtn);
  root.append(button, box);

  const setOpen = (open: boolean) => {
    if (open) {
      root.classList.add(MODAL_SEARCH_OPEN_CLASS);
      input.focus();
    } else {
      root.classList.remove(MODAL_SEARCH_OPEN_CLASS);
    }
    onToggleOpen?.(open);
  };

  if (initialOpen || initialQuery) {
    setOpen(true);
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(true);
  });

  iconWrap.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!input.value) {
      setOpen(false);
      button.focus();
    }
  });

  input.addEventListener('input', () => {
    const val = input.value;
    clearBtn.hidden = !val;
    onQueryChange(val);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (input.value) {
        input.value = '';
        clearBtn.hidden = true;
        onQueryChange('');
      } else {
        setOpen(false);
        button.focus();
      }
    }
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    input.value = '';
    clearBtn.hidden = true;
    onQueryChange('');
    input.focus();
  });

  const handleOutsideClick = (e: MouseEvent) => {
    if (!root.isConnected) {
      document.removeEventListener('click', handleOutsideClick);
      return;
    }
    if (!root.contains(e.target as Node) && !input.value) {
      setOpen(false);
    }
  };
  document.addEventListener('click', handleOutsideClick);

  return root;
}

export const syncPickerSearch = (modal: Element, picker: HTMLElement, database: Database): void => {
  const results = childWithClass(picker, RESULTS_CLASS);
  if (!results) {
    childWithClass(picker, EMPTY_SEARCH_NOTE_CLASS)?.remove();
    picker.removeAttribute(SEARCH_ACTIVE_ATTR);
    return;
  }
  const query = queriesByModal.get(modal) ?? '';
  const normalized = normalizeQuery(query);
  if (!normalized) {
    picker.removeAttribute(SEARCH_ACTIVE_ATTR);
    childWithClass(picker, EMPTY_SEARCH_NOTE_CLASS)?.remove();
    for (const card of results.querySelectorAll<HTMLElement>(`.${ROW}, .modal-trade__card`)) {
      card.removeAttribute(SEARCH_HIDDEN_ATTR);
    }
    return;
  }

  picker.setAttribute(SEARCH_ACTIVE_ATTR, 'true');
  const matchCount = markSearchCards(results, database, query);
  syncEmptyNote(picker, emptyTextOf(results, query, matchCount));
  retriggerPaging(results, picker, true);
};

export function syncModalSearch(pageDocument: Document = document, database: Database = {}): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) {
    const toolbar = modal.querySelector(TOOLBAR);
    const picker = modal.querySelector<HTMLElement>(PICKER);
    if (!toolbar || !picker) continue;

    const ownSearch = toolbar.querySelector<HTMLElement>(`:scope > .${MODAL_SEARCH_CLASS}`);
    if (!isUserCardsStep(modal)) {
      ownSearch?.remove();
      childWithClass(picker, EMPTY_SEARCH_NOTE_CLASS)?.remove();
      picker.removeAttribute(SEARCH_ACTIVE_ATTR);
      continue;
    }

    const lockPopper = toolbar.querySelector(`:scope > .${MODAL_LOCK_POPPER_CLASS}`);
    const refreshBtn = toolbar.querySelector(`:scope > .${MODAL_REFRESH_CLASS}`);

    const searchRoot =
      ownSearch ??
      createModalSearch(
        queriesByModal.get(modal) ?? '',
        openStatesByModal.get(modal) ?? false,
        (nextQuery) => {
          queriesByModal.set(modal, nextQuery);
          syncPickerSearch(modal, picker, database);
        },
        (nextOpen) => {
          openStatesByModal.set(modal, nextOpen);
        }
      );

    if (lockPopper) {
      if (searchRoot.nextElementSibling !== lockPopper) lockPopper.before(searchRoot);
    } else if (refreshBtn) {
      if (searchRoot.nextElementSibling !== refreshBtn) refreshBtn.before(searchRoot);
    } else {
      if (toolbar.lastElementChild !== searchRoot) toolbar.append(searchRoot);
    }

    syncPickerSearch(modal, picker, database);
  }
}

export function updateModalSearch(pageDocument: Document = document, database: Database = {}): void {
  syncModalSearch(pageDocument, database);
}

export const isSearchMutation = createMutationFilter(MODAL, OWN_NODES);

export const createModalSearchWatcher = (host: ModalSearchHost, getDatabase: () => Database = () => ({})) =>
  createFrameWatcher(isSearchMutation, () => updateModalSearch(document, getDatabase()), host.nextFrame);

