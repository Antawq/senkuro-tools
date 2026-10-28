import { USER_CARD_FILTERS } from '../shared/user-card-filters';
import { PERCENT } from '../shared/cards';
import type { Database } from '../shared/database';
import { readPriceRows, readPriceState, type PriceOrder, type PriceRows } from '../shared/price-signal';
import type { Settings } from '../shared/settings';
import { createPriceLookup, sortedIndices } from './price-order';
import { clearOrder, inspectGrid, markState, orderCards, type GridView } from './sort-grid';
import { DIRECTION_ASCENDING, MENU, MENU_ITEM, MODE_ATTRIBUTE, OWN_ITEM, PRICE_MODE, WATCHED_AREAS } from './sort-dom';
import { decorateMenu, findSortTrigger, isPriceMode, reflectLabel } from './sort-menu';

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

export function hasSortMutation(mutations: Iterable<MutationRecord>): boolean {
  for (const { target, addedNodes } of mutations) {
    const targetElement = target instanceof Element ? target : target.parentElement;
    if (targetElement?.closest(WATCHED_AREAS)) return true;
    for (const node of addedNodes) if (node instanceof Element && (node.matches(WATCHED_AREAS) || node.querySelector(WATCHED_AREAS))) return true;
  }
  return false;
}

const percentOf = (loaded: number, total: number | null): number | null => (total ? Math.min(PERCENT, Math.floor((loaded * PERCENT) / total)) : null);

interface SortState {
  pageDocument: Document;
  host: SortHost;
  phase: Phase;
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
  state.phase = 'partial';
  state.rows = null;
  state.sentWith = null;
  state.host.setView(false);
  state.host.schedule();
}

function beginView(state: SortState): void {
  state.phase = 'loading';
  state.percent = null;
  state.rows = null;
  state.sentWith = null;
  state.host.setView(true);
  watchStall(state, state.eventCount);
}

function endView(state: SortState): void {
  if (state.phase === 'idle') return;
  state.phase = 'idle';
  state.rows = null;
  state.sentWith = null;
  state.host.setView(false);
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

function releaseGrid(state: SortState, view: GridView | null): void {
  reflectLabel(state.pageDocument, 'off');
  if (!view) return;
  markState(view.grid, null);
  clearOrder(view.cards);
}

function showGrid(state: SortState, view: GridView, current: PriceInputs): void {
  const { pageDocument, phase } = state;
  if (phase === 'partial') {
    markState(view.grid, 'partial');
    reflectLabel(pageDocument, 'partial');
    orderCards(view.cards, current.database, current.commission, pageDocument.querySelector(DIRECTION_ASCENDING) === null);
    return;
  }
  markState(view.grid, phase === 'loading' ? 'loading' : null);
  clearOrder(view.cards);
  if (phase === 'loading') reflectLabel(pageDocument, 'loading', state.percent);
  else reflectLabel(pageDocument, 'price');
}

function choosePriceMode(state: SortState, filters: Element): void {
  filters.setAttribute(MODE_ATTRIBUTE, PRICE_MODE);
  if (state.phase === 'idle' || state.phase === 'partial') beginView(state);
  findSortTrigger(state.pageDocument)?.click();
  state.host.schedule();
}

const needsNewOrder = (state: SortState, current: PriceInputs): boolean =>
  state.rows !== null &&
  (state.phase === 'loading' || state.phase === 'ready') &&
  (state.sentWith?.database !== current.database || state.sentWith.commission !== current.commission);

function syncSort(state: SortState, current: PriceInputs): void {
  state.inputs = current;
  const filters = state.pageDocument.querySelector(USER_CARD_FILTERS);
  if (!filters) return endView(state);
  const isPriceSelected = isPriceMode(filters);
  decorateMenu(state.pageDocument, isPriceSelected);
  const view = inspectGrid(state.pageDocument);
  if (!isPriceSelected) {
    endView(state);
    return releaseGrid(state, view);
  }
  if (state.phase === 'idle') beginView(state);
  if (needsNewOrder(state, current)) sendOrder(state, current);
  if (view) showGrid(state, view, current);
  else reflectLabel(state.pageDocument, state.phase === 'loading' ? 'loading' : 'price', state.percent);
}

function handleSortClick(state: SortState, event: Event): void {
  const filters = state.pageDocument.querySelector(USER_CARD_FILTERS);
  const menuItem = event.target instanceof Element ? event.target.closest(`${MENU} ${MENU_ITEM}`) : null;
  if (!filters || !menuItem) return;
  if (menuItem.matches(OWN_ITEM)) {
    if (event.target instanceof HTMLInputElement) choosePriceMode(state, filters);
  } else if (isPriceMode(filters)) {
    filters.removeAttribute(MODE_ATTRIBUTE);
    endView(state);
    state.host.schedule();
  }
}

function handleViewState(state: SortState, event: Event): void {
  const viewState = readPriceState(event);
  if (!viewState || state.phase === 'idle' || state.phase === 'partial') return;
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
  const next = readPriceRows(event);
  if (!next || state.phase !== 'loading') return;
  state.eventCount += 1;
  state.rows = next;
  state.revision = 0;
  state.sentWith = null;
  if (state.inputs) sendOrder(state, state.inputs);
}

export function createPriceSort(pageDocument: Document, host: SortHost): PriceSort {
  const state: SortState = { pageDocument, host, phase: 'idle', percent: null, eventCount: 0, rows: null, revision: 0, inputs: null, sentWith: null };
  return {
    sync: (database, { commission }) => syncSort(state, { database, commission }),
    handleClick: (event) => handleSortClick(state, event),
    handleState: (event) => handleViewState(state, event),
    handleRows: (event) => handleViewRows(state, event),
  };
}
