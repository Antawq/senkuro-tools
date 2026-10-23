export const FILTERS = '.user-card__filters';
export const GRID = '.user-cards-grid';
export const CARD = '.user-card';
export const MENU = '#cards-browse-order .dropdown-menu--sm';
export const MENU_ITEM = 'label.radio--list';
export const OWN_ITEM_ATTRIBUTE = 'data-senkutools-sort-item';
export const OWN_ITEM = `[${OWN_ITEM_ATTRIBUTE}]`;
export const TRIGGER = `${FILTERS} > .v-popper > button`;
export const DIRECTION_ASCENDING = `${FILTERS} > button.cards-cnt__nav-filter--asc`;
export const WATCHED_AREAS = `${GRID}, ${FILTERS}, #cards-browse-order`;

export const MODE_ATTRIBUTE = 'data-senkutools-sort';
export const STATE_ATTRIBUTE = 'data-senkutools-sort-state';
export const SAVED_LABEL_ATTRIBUTE = 'data-senkutools-sort-label';
export const PRICE_MODE = 'price';

export type GridState = 'loading' | 'ready' | 'partial';

export const SORT_TEXT = {
  menuItem: 'Цене',
  label: 'По цене',
  partialLabel: 'По цене (часть)',
  partialHint: 'Отсортированы только загруженные карты',
} as const;

export const isOwnLabel = (text: string | null | undefined): boolean => text === SORT_TEXT.label || text === SORT_TEXT.partialLabel;
