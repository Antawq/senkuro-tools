import type { Database } from '../shared/database';
import { readLoaded } from '../shared/list-signal';
import type { Settings } from '../shared/settings';
import { clearOrder, inspectGrid, markState, orderCards, type GridView } from './sort-grid';
import { DIRECTION_ASCENDING, FILTERS, MENU_ITEM, MENU, MODE_ATTRIBUTE, OWN_ITEM, PRICE_MODE, WATCHED_AREAS, type GridState } from './sort-dom';
import { decorateMenu, isPriceMode, reflectLabel, findSortTrigger } from './sort-menu';

const STALL_MS = 15000;

export interface SortHost {
  requestListLoad: () => void;
  runAfter: (run: () => void, delayMs: number) => void;
  schedule: () => void;
}

export interface PriceSort {
  sync: (database: Database, settings: Pick<Settings, 'commission'>) => void;
  handleClick: (event: Event) => void;
  handleLoaded: (event: Event) => void;
}

export function hasSortMutation(mutations: Iterable<MutationRecord>): boolean {
  for (const { target, addedNodes } of mutations) {
    const targetElement = target instanceof Element ? target : target.parentElement;
    if (targetElement?.closest(WATCHED_AREAS)) return true;
    for (const node of addedNodes) if (node instanceof Element && (node.matches(WATCHED_AREAS) || node.querySelector(WATCHED_AREAS))) return true;
  }
  return false;
}

export function createPriceSort(pageDocument: Document, host: SortHost): PriceSort {
  let isLoading = false;
  let triedGridKey: string | null = null;

  const readGridKey = (): string => inspectGrid(pageDocument)?.gridKey ?? '';

  const watchStall = (seenGridKey: string): void =>
    host.runAfter(() => {
      if (!isLoading) return;
      const currentGridKey = readGridKey();
      if (currentGridKey !== seenGridKey) return watchStall(currentGridKey);
      isLoading = false;
      triedGridKey = currentGridKey;
      host.schedule();
    }, STALL_MS);

  function startLoad(seenGridKey: string): void {
    isLoading = true;
    triedGridKey = seenGridKey;
    watchStall(seenGridKey);
    host.requestListLoad();
  }

  function resolveGridState(view: GridView): GridState {
    if (!view.hasMoreCards) return 'ready';
    if (isLoading) return 'loading';
    if (triedGridKey === view.gridKey) return 'partial';
    startLoad(view.gridKey);
    return 'loading';
  }

  function releaseGrid(view: GridView | null): void {
    reflectLabel(pageDocument, 'off');
    if (!view) return;
    markState(view.grid, null);
    clearOrder(view.cards);
  }

  function showGrid(view: GridView, state: GridState, database: Database, commission: boolean): void {
    markState(view.grid, state);
    reflectLabel(pageDocument, state === 'partial' ? 'partial' : 'price');
    if (state === 'loading') clearOrder(view.cards);
    else orderCards(view.cards, database, commission, pageDocument.querySelector(DIRECTION_ASCENDING) === null);
  }

  function choosePriceMode(filters: Element): void {
    filters.setAttribute(MODE_ATTRIBUTE, PRICE_MODE);
    triedGridKey = null;
    findSortTrigger(pageDocument)?.click();
    host.schedule();
  }

  return {
    sync(database, { commission }) {
      const filters = pageDocument.querySelector(FILTERS);
      if (!filters) return;
      const isPriceSelected = isPriceMode(filters);
      decorateMenu(pageDocument, isPriceSelected);
      const view = inspectGrid(pageDocument);
      if (!isPriceSelected) return releaseGrid(view);
      if (view) showGrid(view, resolveGridState(view), database, commission);
      else reflectLabel(pageDocument, 'price');
    },
    handleClick(event) {
      const filters = pageDocument.querySelector(FILTERS);
      const menuItem = event.target instanceof Element ? event.target.closest(`${MENU} ${MENU_ITEM}`) : null;
      if (!filters || !menuItem) return;
      if (menuItem.matches(OWN_ITEM)) {
        if (event.target instanceof HTMLInputElement) choosePriceMode(filters);
      } else if (isPriceMode(filters)) {
        filters.removeAttribute(MODE_ATTRIBUTE);
        host.schedule();
      }
    },
    handleLoaded(event) {
      const outcome = readLoaded(event);
      if (outcome === null) return;
      isLoading = false;
      if (outcome === 'partial') triedGridKey = readGridKey();
      host.schedule();
    },
  };
}
