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

export const topModal = (doc: Document, isSpent: (modal: HTMLElement) => boolean = () => false): HTMLElement | null => {
  const open = [...doc.querySelectorAll<HTMLElement>(SEARCH_MODAL)].filter(
    (modal) => !isSpent(modal) && !modal.closest(MODAL_HOST)?.classList.contains(MODAL_CLOSING_CLASS)
  );
  return open.at(-1) ?? null;
};

export const fieldOf = (modal: HTMLElement): HTMLInputElement | null => modal.querySelector<HTMLInputElement>(SEARCH_FIELD);

export const rowsOf = (modal: HTMLElement): HTMLElement[] => [...modal.querySelectorAll<HTMLElement>(RESULT_ROW)];

export const isTooShort = (query: string): boolean => query.trim().length < MIN_QUERY_CHARACTERS;

export const signatureOf = (rows: HTMLElement[]): string => rows.map((row) => row.getAttribute('href') ?? '').join('|');

export interface SearchHost {
  later: (run: () => void, ms: number) => void;
  alive: () => boolean;
  signals: SearchSignals;
}
