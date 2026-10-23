import type { SearchSignals } from './search-signal';

export const MODAL = '.modal-content--search';
const HOST = '.vfm';
const CLOSING = 'vfm--prevent-none';
export const FIELD = 'input.input-el';
export const LIST = '.nav-search__cnt';
export const ROW = '[data-index]';
export const ACTIVE = 'card-search--active';
export const TITLE = '.card-title, .card-name';
export const TAB = '.tabs-tab';
export const TAB_ACTIVE = '.tabs-tab--active';
export const OPEN_BUTTON = '.nav-search__btn';
export const ANY_MODAL = '.modal-content';
export const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
export const MIN_QUERY_LENGTH = 2;

export const topModal = (doc: Document, isSpent: (modal: HTMLElement) => boolean = () => false): HTMLElement | null => {
  const open = [...doc.querySelectorAll<HTMLElement>(MODAL)].filter((modal) => !isSpent(modal) && !modal.closest(HOST)?.classList.contains(CLOSING));
  return open.at(-1) ?? null;
};

export const fieldOf = (modal: HTMLElement): HTMLInputElement | null => modal.querySelector<HTMLInputElement>(FIELD);

export const rowsOf = (modal: HTMLElement): HTMLElement[] => [...modal.querySelectorAll<HTMLElement>(ROW)];

export const isTooShort = (query: string): boolean => query.trim().length < MIN_QUERY_LENGTH;

export const signatureOf = (rows: HTMLElement[]): string => rows.map((row) => row.getAttribute('href') ?? '').join('|');

export interface SearchHost {
  later: (run: () => void, ms: number) => void;
  alive: () => boolean;
  signals: SearchSignals;
}
