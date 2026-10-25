import { PERCENT } from '../shared/cards';
import type { Database } from '../shared/database';
import { readPriceRows, readPriceState, type PriceOrder, type PriceRows } from '../shared/price-signal';
import type { Settings } from '../shared/settings';
import { createPriceLookup, sortedIndices } from './price-order';
import { clearOrder, inspectGrid, markState, orderCards, type GridView } from './sort-grid';
import { DIRECTION_ASCENDING, FILTERS, MENU, MENU_ITEM, MODE_ATTRIBUTE, OWN_ITEM, PRICE_MODE, WATCHED_AREAS } from './sort-dom';
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

export function createPriceSort(pageDocument: Document, host: SortHost): PriceSort {
  let phase: Phase = 'idle';
  let percent: number | null = null;
  let eventCount = 0;
  let rows: PriceRows | null = null;
  let revision = 0;
  let inputs: PriceInputs | null = null;
  let sentWith: PriceInputs | null = null;

  const watchStall = (seenEventCount: number): void =>
    host.runAfter(() => {
      if (phase !== 'loading') return;
      if (eventCount !== seenEventCount) return watchStall(eventCount);
      fallBack();
    }, STALL_MS);

  function fallBack(): void {
    if (phase === 'partial' || phase === 'idle') return;
    phase = 'partial';
    rows = null;
    sentWith = null;
    host.setView(false);
    host.schedule();
  }

  function beginView(): void {
    phase = 'loading';
    percent = null;
    rows = null;
    sentWith = null;
    host.setView(true);
    watchStall(eventCount);
  }

  function endView(): void {
    if (phase === 'idle') return;
    phase = 'idle';
    rows = null;
    sentWith = null;
    host.setView(false);
  }

  function sendOrder(current: PriceInputs): void {
    if (!rows) return;
    revision += 1;
    const lookup = createPriceLookup(current.database, current.commission);
    host.sendOrder({ viewId: rows.viewId, revision, descending: sortedIndices(rows.slugs, lookup, true), ascending: sortedIndices(rows.slugs, lookup, false) });
    sentWith = current;
  }

  function releaseGrid(view: GridView | null): void {
    reflectLabel(pageDocument, 'off');
    if (!view) return;
    markState(view.grid, null);
    clearOrder(view.cards);
  }

  function showGrid(view: GridView, current: PriceInputs): void {
    if (phase === 'partial') {
      markState(view.grid, 'partial');
      reflectLabel(pageDocument, 'partial');
      orderCards(view.cards, current.database, current.commission, pageDocument.querySelector(DIRECTION_ASCENDING) === null);
      return;
    }
    markState(view.grid, phase === 'loading' ? 'loading' : null);
    clearOrder(view.cards);
    if (phase === 'loading') reflectLabel(pageDocument, 'loading', percent);
    else reflectLabel(pageDocument, 'price');
  }

  function choosePriceMode(filters: Element): void {
    filters.setAttribute(MODE_ATTRIBUTE, PRICE_MODE);
    if (phase === 'idle' || phase === 'partial') beginView();
    findSortTrigger(pageDocument)?.click();
    host.schedule();
  }

  return {
    sync(database, { commission }) {
      const current = { database, commission };
      inputs = current;
      const filters = pageDocument.querySelector(FILTERS);
      if (!filters) return endView();
      const isPriceSelected = isPriceMode(filters);
      decorateMenu(pageDocument, isPriceSelected);
      const view = inspectGrid(pageDocument);
      if (!isPriceSelected) {
        endView();
        return releaseGrid(view);
      }
      if (phase === 'idle') beginView();
      if (rows && (phase === 'loading' || phase === 'ready') && (sentWith?.database !== database || sentWith.commission !== commission)) sendOrder(current);
      if (view) showGrid(view, current);
      else reflectLabel(pageDocument, phase === 'loading' ? 'loading' : 'price', percent);
    },

    handleClick(event) {
      const filters = pageDocument.querySelector(FILTERS);
      const menuItem = event.target instanceof Element ? event.target.closest(`${MENU} ${MENU_ITEM}`) : null;
      if (!filters || !menuItem) return;
      if (menuItem.matches(OWN_ITEM)) {
        if (event.target instanceof HTMLInputElement) choosePriceMode(filters);
      } else if (isPriceMode(filters)) {
        filters.removeAttribute(MODE_ATTRIBUTE);
        endView();
        host.schedule();
      }
    },

    handleState(event) {
      const state = readPriceState(event);
      if (!state || phase === 'idle' || phase === 'partial') return;
      eventCount += 1;
      if (state.name === 'loading') {
        if (phase === 'ready') {
          rows = null;
          sentWith = null;
          watchStall(eventCount);
        }
        phase = 'loading';
        percent = percentOf(state.loaded, state.total);
      } else if (state.name === 'ready') phase = 'ready';
      else fallBack();
      host.schedule();
    },

    handleRows(event) {
      const next = readPriceRows(event);
      if (!next || phase !== 'loading') return;
      eventCount += 1;
      rows = next;
      revision = 0;
      sentWith = null;
      if (inputs) sendOrder(inputs);
    },
  };
}
