import { HEADER, RESULTS_CLASS, TOOLBAR } from '../shared/trade-modal';
import { USER_CARD_FILTERS } from '../shared/user-card-filters';
export const GRID = '.user-cards-grid';
export const CARD = '.user-card';
export const DECK = '.card-browse';
export const DECK_TOOLBAR = '.card-browse__form';
export const DECK_RESULTS = '.card-browse__cnt-result';
const MENU_ID = 'cards-browse-order';
export const MENU = `#${MENU_ID} .dropdown-menu--sm`;
export const MENU_ITEM = 'label.radio--list';
export const OPEN_TRIGGER = `[aria-describedby="${MENU_ID}"][data-popper-shown]`;
export const OWN_ITEM_ATTRIBUTE = 'data-senkutools-sort-item';
export const OWN_ITEM = `[${OWN_ITEM_ATTRIBUTE}]`;
export const TRIGGER = ':scope > .v-popper > button';
export const DIRECTION_ASCENDING = ':scope > button.cards-cnt__nav-filter--asc';
export const WATCHED_AREAS = [GRID, USER_CARD_FILTERS, `#${MENU_ID}`, DECK_TOOLBAR, DECK_RESULTS, HEADER, TOOLBAR, `.${RESULTS_CLASS}`].join(', ');

export const MODE_ATTRIBUTE = 'data-senkutools-sort';
export const STATE_ATTRIBUTE = 'data-senkutools-sort-state';
export const SAVED_LABEL_ATTRIBUTE = 'data-senkutools-sort-label';
export const PRICE_MODE = 'price';

export type GridState = 'loading' | 'partial';

export const SORT_TEXT = {
  menuItem: 'Цене',
  label: 'По цене',
  partialLabel: 'По цене (часть)',
  partialHint: 'Отсортированы только загруженные карты',
} as const;

const PROGRESS = /^\d+%$/;

export const loadingLabelOf = (percent: number | null): string => (percent === null ? SORT_TEXT.label : `${SORT_TEXT.label} ${percent}%`);

const isProgressLabel = (text: string): boolean => text.startsWith(`${SORT_TEXT.label} `) && PROGRESS.test(text.slice(SORT_TEXT.label.length + 1));

export const isOwnLabel = (text: string | null | undefined): boolean =>
  text === SORT_TEXT.label || text === SORT_TEXT.partialLabel || isProgressLabel(text ?? '');

export function writeAttribute(target: Element, name: string, value: string | null): void {
  if (value === null) target.removeAttribute(name);
  else if (target.getAttribute(name) !== value) target.setAttribute(name, value);
}
