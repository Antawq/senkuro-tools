import type { ListScope } from '../shared/list-scope';
import { MODAL_CONTENT_SELECTOR } from '../shared/modal-selectors';
import { MODAL, RESULTS_CLASS, TOOLBAR, isCatalogStep } from '../shared/trade-modal';
import { USER_CARD_FILTERS } from '../shared/user-card-filters';
import { DECK, DECK_RESULTS, DECK_TOOLBAR, GRID, OPEN_TRIGGER } from './sort-dom';

export interface SortPlace {
  scope: ListScope;
  toolbar: Element;
  results: HTMLElement | null;
  isCardList: boolean;
  canOrderLoadedCards: boolean;
  mobileClass: string | null;
  listArea: Element | null;
}

export interface ClickedPlace {
  place: SortPlace;
  trigger: HTMLElement;
}

interface PlaceKind {
  toolbar: string;
  scope: ListScope;
  canOrderLoadedCards: boolean;
  mobileClass: string | null;
  resultsOf: (toolbar: Element) => HTMLElement | null;
  listAreaOf: (toolbar: Element) => Element | null;
  isCardList: (toolbar: Element) => boolean;
}

const WINDOW_TOOLBAR = `${MODAL} ${TOOLBAR}`;
const GRID_AREA = 'section';
const DECK_AREA = '.card-browse__cnt';
const WINDOW_AREA = '.modal-trade__body';
const PAGE_TOOLBARS = `${USER_CARD_FILTERS}, ${DECK_TOOLBAR}`;

const withinWindow = (toolbar: Element): Element | null => toolbar.closest(MODAL);

const PLACE_KINDS: readonly PlaceKind[] = [
  {
    toolbar: USER_CARD_FILTERS,
    scope: 'grid',
    canOrderLoadedCards: true,
    mobileClass: null,
    resultsOf: (toolbar) => toolbar.ownerDocument.querySelector<HTMLElement>(GRID),
    listAreaOf: (toolbar) => toolbar.closest(GRID_AREA),
    isCardList: () => true,
  },
  {
    toolbar: DECK_TOOLBAR,
    scope: 'picker',
    canOrderLoadedCards: false,
    mobileClass: 'card-browse__form__mob',
    resultsOf: (toolbar) => toolbar.closest(DECK)?.querySelector<HTMLElement>(DECK_RESULTS) ?? null,
    listAreaOf: (toolbar) => toolbar.closest(DECK)?.querySelector(DECK_AREA) ?? null,
    isCardList: () => true,
  },
  {
    toolbar: WINDOW_TOOLBAR,
    scope: 'picker',
    canOrderLoadedCards: false,
    mobileClass: 'modal-trade__header-form__mob',
    resultsOf: (toolbar) => withinWindow(toolbar)?.querySelector<HTMLElement>(`.${RESULTS_CLASS}`) ?? null,
    listAreaOf: (toolbar) => withinWindow(toolbar)?.querySelector(WINDOW_AREA) ?? null,
    isCardList: (toolbar) => {
      const modal = withinWindow(toolbar);
      return modal !== null && !isCatalogStep(modal);
    },
  },
];

const ANY_TOOLBAR = PLACE_KINDS.map((kind) => kind.toolbar).join(', ');

function placeOf(toolbar: Element): SortPlace | null {
  const kind = PLACE_KINDS.find((candidate) => toolbar.matches(candidate.toolbar));
  if (!kind) return null;
  const { scope, canOrderLoadedCards, mobileClass } = kind;
  return {
    scope,
    toolbar,
    results: kind.resultsOf(toolbar),
    listArea: kind.listAreaOf(toolbar),
    isCardList: kind.isCardList(toolbar),
    canOrderLoadedCards,
    mobileClass,
  };
}

export const findPlaces = (pageDocument: Document, scope: ListScope): SortPlace[] =>
  [...pageDocument.querySelectorAll(ANY_TOOLBAR)].flatMap((toolbar) => placeOf(toolbar) ?? []).filter((place) => place.scope === scope);

function findTopToolbar(pageDocument: Document): Element | null {
  const modals = pageDocument.querySelectorAll(MODAL_CONTENT_SELECTOR);
  const topModal = modals.item(modals.length - 1);
  if (!topModal) return pageDocument.querySelector(PAGE_TOOLBARS);
  return topModal.matches(MODAL) ? topModal.querySelector(TOOLBAR) : null;
}

export function findMenuPlace(pageDocument: Document): SortPlace | null {
  const toolbar = findTopToolbar(pageDocument);
  return toolbar ? placeOf(toolbar) : null;
}

export function findClickedPlace(pageDocument: Document): ClickedPlace | null {
  const trigger = pageDocument.querySelector<HTMLElement>(OPEN_TRIGGER);
  const toolbar = trigger?.closest(ANY_TOOLBAR);
  const place = toolbar ? placeOf(toolbar) : null;
  return trigger && place ? { place, trigger } : null;
}
