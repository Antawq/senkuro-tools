export const MODAL = '.modal-content--search';
export const HOST = '.vfm';
export const CLOSING = 'vfm--prevent-none';
export const FIELD = 'input.input-el';
export const LIST = '.nav-search__cnt';
export const ROW = '[data-index]';
export const ACTIVE = 'card-search--active';
export const TITLE = '.card-title, .card-name';
export const MIN_QUERY_LENGTH = 2;

export const topModal = (doc: Document, isSpent: (modal: HTMLElement) => boolean = () => false): HTMLElement | null => {
  const open = [...doc.querySelectorAll<HTMLElement>(MODAL)].filter((modal) => !isSpent(modal) && !modal.closest(HOST)?.classList.contains(CLOSING));
  return open.at(-1) ?? null;
};

export const fieldOf = (modal: HTMLElement): HTMLInputElement | null => modal.querySelector<HTMLInputElement>(FIELD);

export const rowsOf = (modal: HTMLElement): HTMLElement[] => [...modal.querySelectorAll<HTMLElement>(ROW)];

export const isTooShort = (query: string): boolean => query.trim().length < MIN_QUERY_LENGTH;
