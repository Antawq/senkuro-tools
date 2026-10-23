import type { SearchSignals } from './search-signal';

export const SEARCH_MODAL = '.modal-content--search';
const MODAL_HOST = '.vfm';
const MODAL_CLOSING_CLASS = 'vfm--prevent-none';
export const SEARCH_FIELD = 'input.input-el';
export const RESULTS = '.nav-search__cnt';
export const RESULT_ROW = '[data-index]';
export const ACTIVE_ROW_CLASS = 'card-search--active';
export const RESULT_TITLE = '.card-title, .card-name';
export const TAB = '.tabs-tab';
export const ACTIVE_TAB = '.tabs-tab--active';
export const OPEN_BUTTON = '.nav-search__btn';
export const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
export const MIN_QUERY_CHARACTERS = 2;

export const findTopSearchModal = (doc: Document, isSpent: (searchModal: HTMLElement) => boolean = () => false): HTMLElement | null => {
  const openSearchModals = [...doc.querySelectorAll<HTMLElement>(SEARCH_MODAL)].filter(
    (searchModal) => !isSpent(searchModal) && !searchModal.closest(MODAL_HOST)?.classList.contains(MODAL_CLOSING_CLASS)
  );
  return openSearchModals.at(-1) ?? null;
};

export const fieldOf = (searchModal: HTMLElement): HTMLInputElement | null => searchModal.querySelector<HTMLInputElement>(SEARCH_FIELD);

export const rowsOf = (searchModal: HTMLElement): HTMLElement[] => [...searchModal.querySelectorAll<HTMLElement>(RESULT_ROW)];

export const isTooShort = (query: string): boolean => query.trim().length < MIN_QUERY_CHARACTERS;

export const signatureOf = (rows: HTMLElement[]): string => rows.map((row) => row.getAttribute('href') ?? '').join('|');

export interface SearchHost {
  runAfter: (run: () => void, delayMs: number) => void;
  isContextValid: () => boolean;
  signals: SearchSignals;
}
