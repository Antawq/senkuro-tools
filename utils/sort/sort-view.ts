import { PERCENT } from '../shared/cards';
import type { Database } from '../shared/database';
import type { ListScope } from '../shared/list-scope';
import { priceRowsSignal, priceStateSignal, type PriceOrder, type PriceRows, type ViewSort } from '../shared/price-signal';
import { isGuardReady } from '../shared/refresh-signal';
import type { Settings } from '../shared/settings';
import { createPriceLookup, listOrders } from './price-order';
import { rangeKeyOf, readRange, writeRange, type PriceRange } from './price-range';
import { RANGE_TEXT, rangeLabelOf, removeRangeControl, syncRangeControl } from './range-control';
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

interface SentOrder extends PriceInputs {
  sort: ViewSort;
  rangeKey: string | null;
}

export interface SortHost {
  setView: (isOn: boolean, sort: ViewSort) => void;
  sendOrder: (order: PriceOrder) => void;
  runAfter: (run: () => void, delayMs: number) => void;
  schedule: () => void;
}

export interface PriceSort {
  sync: (database: Database, settings: Pick<Settings, 'commission'>) => void;
  applyRange: (toolbar: Element, range: PriceRange | null) => void;
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

const isActive = (toolbar: Element): boolean => isPriceMode(toolbar) || readRange(toolbar) !== null;

const sortOf = (toolbar: Element): ViewSort => (isPriceMode(toolbar) ? 'price' : 'site');

interface SortState {
  pageDocument: Document;
  scope: ListScope;
  host: SortHost;
  phase: Phase;
  place: SortPlace | null;
  sort: ViewSort;
  percent: number | null;
  eventCount: number;
  rows: PriceRows | null;
  revision: number;
  inputs: PriceInputs | null;
  sentWith: SentOrder | null;
}

const isViewRunning = (state: SortState): boolean => state.phase === 'loading' || state.phase === 'ready';

function watchStall(state: SortState, seenEventCount: number): void {
  state.host.runAfter(() => {
    if (state.phase !== 'loading') return;
    if (state.eventCount !== seenEventCount) return watchStall(state, state.eventCount);
    fallBack(state);
  }, STALL_MS);
}

function fallBack(state: SortState): void {
  if (!isViewRunning(state)) return;
  const place = state.place;
  if (place) writeRange(place.toolbar, null);
  if (place && (!place.canOrderLoadedCards || !isPriceMode(place.toolbar))) return endMode(state, place.toolbar);
  state.phase = 'partial';
  state.rows = null;
  state.sentWith = null;
  state.host.setView(false, state.sort);
  state.host.schedule();
}

function beginView(state: SortState, place: SortPlace, sort: ViewSort): void {
  state.phase = 'loading';
  state.place = place;
  state.sort = sort;
  state.percent = null;
  state.rows = null;
  state.sentWith = null;
  state.host.setView(true, sort);
  watchStall(state, state.eventCount);
}

function switchSort(state: SortState, sort: ViewSort): void {
  if (!isViewRunning(state) || state.sort === sort) return;
  state.sort = sort;
  state.host.setView(true, sort);
}

function endView(state: SortState): void {
  if (state.phase === 'idle') return;
  state.phase = 'idle';
  state.place = null;
  state.rows = null;
  state.sentWith = null;
  state.host.setView(false, state.sort);
}

function endMode(state: SortState, toolbar: Element): void {
  toolbar.removeAttribute(MODE_ATTRIBUTE);
  writeRange(toolbar, null);
  endView(state);
  state.host.schedule();
}

function sendOrder(state: SortState, current: PriceInputs): void {
  const rows = state.rows;
  if (!rows) return;
  const range = state.place ? readRange(state.place.toolbar) : null;
  state.revision += 1;
  const orders = listOrders(rows.slugs, createPriceLookup(current.database, current.commission), state.sort, range);
  state.host.sendOrder({ viewId: rows.viewId, revision: state.revision, ...orders });
  state.sentWith = { ...current, sort: state.sort, rangeKey: rangeKeyOf(range) };
}

function releasePlace(place: SortPlace): void {
  place.toolbar.removeAttribute(MODE_ATTRIBUTE);
  writeRange(place.toolbar, null);
  reflectLabel(place.toolbar, 'off');
  if (!place.results) return;
  markState(place.results, null);
  clearOrder(cardsOf(place.results));
}

function showLabel(state: SortState, toolbar: Element): void {
  if (!isPriceMode(toolbar)) reflectLabel(toolbar, 'off');
  else reflectLabel(toolbar, state.phase === 'loading' ? 'loading' : 'price', state.percent);
}

function showPlace(state: SortState, place: SortPlace, current: PriceInputs): void {
  const { results, toolbar } = place;
  if (!results) return showLabel(state, toolbar);
  if (state.phase === 'partial') {
    markState(results, 'partial');
    reflectLabel(toolbar, 'partial');
    orderCards(cardsOf(results), current.database, current.commission, toolbar.querySelector(DIRECTION_ASCENDING) === null);
    return;
  }
  markState(results, state.phase === 'loading' ? 'loading' : null);
  clearOrder(cardsOf(results));
  showLabel(state, toolbar);
}

function takePlace(state: SortState, place: SortPlace): void {
  if (state.place && state.place.toolbar !== place.toolbar) endMode(state, state.place.toolbar);
}

function startOrSwitch(state: SortState, place: SortPlace): void {
  const sort = sortOf(place.toolbar);
  if (state.phase === 'idle' || state.phase === 'partial') beginView(state, place, sort);
  else switchSort(state, sort);
}

function choosePriceMode(state: SortState, { place, trigger }: ClickedPlace): void {
  takePlace(state, place);
  place.toolbar.setAttribute(MODE_ATTRIBUTE, PRICE_MODE);
  startOrSwitch(state, place);
  trigger.click();
  state.host.schedule();
}

function leavePriceMode(state: SortState, toolbar: Element): void {
  toolbar.removeAttribute(MODE_ATTRIBUTE);
  if (readRange(toolbar)) switchSort(state, 'site');
  else endView(state);
  state.host.schedule();
}

function applyRange(state: SortState, toolbar: Element, range: PriceRange | null): void {
  const place = findPlaces(state.pageDocument, state.scope).find((candidate) => candidate.toolbar === toolbar);
  if (!place?.isCardList || rangeKeyOf(readRange(toolbar)) === rangeKeyOf(range)) return;
  takePlace(state, place);
  writeRange(toolbar, range);
  if (isActive(toolbar)) startOrSwitch(state, place);
  else endView(state);
  state.host.schedule();
}

const needsNewOrder = (state: SortState, current: PriceInputs, place: SortPlace): boolean => {
  const sent = state.sentWith;
  if (state.rows === null || !isViewRunning(state)) return false;
  if (sent?.database !== current.database || sent.commission !== current.commission) return true;
  return sent.sort !== state.sort || sent.rangeKey !== rangeKeyOf(readRange(place.toolbar));
};

function decorateOpenMenu(state: SortState): void {
  const menuPlace = findMenuPlace(state.pageDocument);
  if (menuPlace?.scope === state.scope && menuPlace.isCardList) decorateMenu(state.pageDocument, isPriceMode(menuPlace.toolbar));
}

function rangeLabelFor(state: SortState, place: SortPlace): string {
  const isLoading = state.phase === 'loading' && state.place?.toolbar === place.toolbar && readRange(place.toolbar) !== null;
  return isLoading ? rangeLabelOf(state.percent) : RANGE_TEXT.trigger;
}

function syncRangeControls(state: SortState, places: SortPlace[]): void {
  const canFilter = isGuardReady(state.pageDocument);
  for (const place of places) {
    if (!canFilter || !place.isCardList) removeRangeControl(place.toolbar);
    else
      syncRangeControl(place.toolbar, place.mobileClass, { label: rangeLabelFor(state, place), range: readRange(place.toolbar) }, (toolbar, range) =>
        applyRange(state, toolbar, range)
      );
  }
}

function syncActivePlace(state: SortState, current: PriceInputs, places: SortPlace[]): void {
  const place = places.find((candidate) => candidate.isCardList && isActive(candidate.toolbar));
  for (const other of places) if (other !== place) releasePlace(other);
  if (!place) return endView(state);
  if (state.phase === 'idle') beginView(state, place, sortOf(place.toolbar));
  else switchSort(state, sortOf(place.toolbar));
  state.place = place;
  if (needsNewOrder(state, current, place)) sendOrder(state, current);
  showPlace(state, place, current);
}

function syncSort(state: SortState, current: PriceInputs): void {
  state.inputs = current;
  const places = findPlaces(state.pageDocument, state.scope);
  decorateOpenMenu(state);
  syncActivePlace(state, current, places);
  syncRangeControls(state, places);
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
  } else if (isPriceMode(clicked.place.toolbar)) leavePriceMode(state, clicked.place.toolbar);
}

const isListening = (state: SortState, scope: ListScope): boolean => scope === state.scope && isViewRunning(state);

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
    sort: 'price',
    percent: null,
    eventCount: 0,
    rows: null,
    revision: 0,
    inputs: null,
    sentWith: null,
  };
  return {
    sync: (database, { commission }) => syncSort(state, { database, commission }),
    applyRange: (toolbar, range) => applyRange(state, toolbar, range),
    handleClick: (event) => handleSortClick(state, event),
    handleState: (event) => handleViewState(state, event),
    handleRows: (event) => handleViewRows(state, event),
  };
}
