import { PERCENT } from '../shared/cards';
import type { Database } from '../shared/database';
import type { ListScope } from '../shared/list-scope';
import { priceRowsSignal, priceStateSignal, type PriceOrder, type PriceRows } from '../shared/price-signal';
import type { Settings } from '../shared/settings';
import { createPriceLookup, sortedIndices } from './price-order';
import { DIRECTION_ASCENDING, MENU, MENU_ITEM, MODE_ATTRIBUTE, OWN_ITEM, PRICE_MODE, WATCHED_AREAS } from './sort-dom';
import { cardsOf, clearOrder, markState, orderCards } from './sort-grid';
import { decorateMenu, isPriceMode, reflectLabel } from './sort-menu';
import { findClickedPlace, findMenuPlace, findPlaces, type ClickedPlace, type SortPlace } from './sort-places';

const STALL_MS = 15000;

type Phase = 'idle' | 'loading' | 'ready' | 'partial';

interface PriceInputs {
  database: Database;
  commission: boolean;
}

export interface SortHost {
  setView: (isOn: boolean) => void;
  sendOrder: (order: PriceOrder) => void;
  runAfter: (run: () => void, delayMs: number) => void;
  schedule: () => void;
}

export interface PriceSort {
  sync: (database: Database, settings: Pick<Settings, 'commission'>) => void;
  handleClick: (event: Event) => void;
  handleState: (event: Event) => void;
  handleRows: (event: Event) => void;
}

const isInWatchedArea = (node: Node): boolean => node instanceof Element && (node.matches(WATCHED_AREAS) || node.querySelector(WATCHED_AREAS) !== null);

export function hasSortMutation(mutations: Iterable<MutationRecord>): boolean {
  for (const { target, addedNodes, removedNodes } of mutations) {
    const targetElement = target instanceof Element ? target : target.parentElement;
    if (targetElement?.closest(WATCHED_AREAS) || [...addedNodes, ...removedNodes].some(isInWatchedArea)) return true;
  }
  return false;
}

const percentOf = (loaded: number, total: number | null): number | null => (total ? Math.min(PERCENT, Math.floor((loaded * PERCENT) / total)) : null);

interface SortState {
  pageDocument: Document;
  scope: ListScope;
  host: SortHost;
  phase: Phase;
  place: SortPlace | null;
  percent: number | null;
  eventCount: number;
  rows: PriceRows | null;
  revision: number;
  inputs: PriceInputs | null;
  sentWith: PriceInputs | null;
}

function watchStall(state: SortState, seenEventCount: number): void {
  state.host.runAfter(() => {
    if (state.phase !== 'loading') return;
    if (state.eventCount !== seenEventCount) return watchStall(state, state.eventCount);
    fallBack(state);
  }, STALL_MS);
}

function fallBack(state: SortState): void {
  if (state.phase === 'partial' || state.phase === 'idle') return;
  if (state.place && !state.place.canOrderLoadedCards) return endMode(state, state.place.toolbar);
  state.phase = 'partial';
  state.rows = null;
  state.sentWith = null;
  state.host.setView(false);
  state.host.schedule();
}

function beginView(state: SortState, place: SortPlace): void {
  state.phase = 'loading';
  state.place = place;
  state.percent = null;
  state.rows = null;
  state.sentWith = null;
  state.host.setView(true);
  watchStall(state, state.eventCount);
}

function endView(state: SortState): void {
  if (state.phase === 'idle') return;
  state.phase = 'idle';
  state.place = null;
  state.rows = null;
  state.sentWith = null;
  state.host.setView(false);
}

function endMode(state: SortState, toolbar: Element): void {
  toolbar.removeAttribute(MODE_ATTRIBUTE);
  endView(state);
  state.host.schedule();
}

function sendOrder(state: SortState, current: PriceInputs): void {
  const rows = state.rows;
  if (!rows) return;
  state.revision += 1;
  const lookup = createPriceLookup(current.database, current.commission);
  state.host.sendOrder({
    viewId: rows.viewId,
    revision: state.revision,
    descending: sortedIndices(rows.slugs, lookup, true),
    ascending: sortedIndices(rows.slugs, lookup, false),
  });
  state.sentWith = current;
}

function releasePlace(place: SortPlace): void {
  place.toolbar.removeAttribute(MODE_ATTRIBUTE);
  reflectLabel(place.toolbar, 'off');
  if (!place.results) return;
  markState(place.results, null);
  clearOrder(cardsOf(place.results));
}

const showLabel = (state: SortState, place: SortPlace): void => reflectLabel(place.toolbar, state.phase === 'loading' ? 'loading' : 'price', state.percent);

function showPlace(state: SortState, place: SortPlace, current: PriceInputs): void {
  const { results, toolbar } = place;
  if (!results) return showLabel(state, place);
  if (state.phase === 'partial') {
    markState(results, 'partial');
    reflectLabel(toolbar, 'partial');
    orderCards(cardsOf(results), current.database, current.commission, toolbar.querySelector(DIRECTION_ASCENDING) === null);
    return;
  }
  markState(results, state.phase === 'loading' ? 'loading' : null);
  clearOrder(cardsOf(results));
  showLabel(state, place);
}

function choosePriceMode(state: SortState, { place, trigger }: ClickedPlace): void {
  if (state.place && state.place.toolbar !== place.toolbar) endMode(state, state.place.toolbar);
  place.toolbar.setAttribute(MODE_ATTRIBUTE, PRICE_MODE);
  if (state.phase === 'idle' || state.phase === 'partial') beginView(state, place);
  trigger.click();
  state.host.schedule();
}

const needsNewOrder = (state: SortState, current: PriceInputs): boolean =>
  state.rows !== null &&
  (state.phase === 'loading' || state.phase === 'ready') &&
  (state.sentWith?.database !== current.database || state.sentWith.commission !== current.commission);

function decorateOpenMenu(state: SortState): void {
  const menuPlace = findMenuPlace(state.pageDocument);
  if (menuPlace?.scope === state.scope && menuPlace.isCardList) decorateMenu(state.pageDocument, isPriceMode(menuPlace.toolbar));
}

function syncSort(state: SortState, current: PriceInputs): void {
  state.inputs = current;
  const places = findPlaces(state.pageDocument, state.scope);
  decorateOpenMenu(state);
  const place = places.find((candidate) => candidate.isCardList && isPriceMode(candidate.toolbar));
  for (const other of places) if (other !== place) releasePlace(other);
  if (!place) return endView(state);
  if (state.phase === 'idle') beginView(state, place);
  if (needsNewOrder(state, current)) sendOrder(state, current);
  showPlace(state, place, current);
}

function findClickedItem(state: SortState, event: Event): { menuItem: Element; clicked: ClickedPlace } | null {
  const menuItem = event.target instanceof Element ? event.target.closest(`${MENU} ${MENU_ITEM}`) : null;
  const clicked = menuItem ? findClickedPlace(state.pageDocument) : null;
  return menuItem && clicked?.place.scope === state.scope && clicked.place.isCardList ? { menuItem, clicked } : null;
}

function handleSortClick(state: SortState, event: Event): void {
  const clickedItem = findClickedItem(state, event);
  if (!clickedItem) return;
  const { menuItem, clicked } = clickedItem;
  if (menuItem.matches(OWN_ITEM)) {
    if (event.target instanceof HTMLInputElement) choosePriceMode(state, clicked);
  } else if (isPriceMode(clicked.place.toolbar)) endMode(state, clicked.place.toolbar);
}

const isListening = (state: SortState, scope: ListScope): boolean => scope === state.scope && state.phase !== 'idle' && state.phase !== 'partial';

function handleViewState(state: SortState, event: Event): void {
  const viewState = priceStateSignal.read(event);
  if (!viewState || !isListening(state, viewState.scope)) return;
  state.eventCount += 1;
  if (viewState.name === 'loading') {
    if (state.phase === 'ready') {
      state.rows = null;
      state.sentWith = null;
      watchStall(state, state.eventCount);
    }
    state.phase = 'loading';
    state.percent = percentOf(viewState.loaded, viewState.total);
  } else if (viewState.name === 'ready') state.phase = 'ready';
  else fallBack(state);
  state.host.schedule();
}

function handleViewRows(state: SortState, event: Event): void {
  const scopedRows = priceRowsSignal.read(event);
  if (!scopedRows || scopedRows.scope !== state.scope || state.phase !== 'loading') return;
  state.eventCount += 1;
  state.rows = { viewId: scopedRows.viewId, slugs: scopedRows.slugs };
  state.revision = 0;
  state.sentWith = null;
  if (state.inputs) sendOrder(state, state.inputs);
}

export function createPriceSort(pageDocument: Document, scope: ListScope, host: SortHost): PriceSort {
  const state: SortState = {
    pageDocument,
    scope,
    host,
    phase: 'idle',
    place: null,
    percent: null,
    eventCount: 0,
    rows: null,
    revision: 0,
    inputs: null,
    sentWith: null,
  };
  return {
    sync: (database, { commission }) => syncSort(state, { database, commission }),
    handleClick: (event) => handleSortClick(state, event),
    handleState: (event) => handleViewState(state, event),
    handleRows: (event) => handleViewRows(state, event),
  };
}
