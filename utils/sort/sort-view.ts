import type { Database } from '../shared/database';
import { readLoaded } from '../shared/list-signal';
import type { Settings } from '../shared/settings';
import { clearOrder, inspectGrid, markState, orderCards, type GridView } from './sort-grid';
import { DIRECTION_ASCENDING, FILTERS, ITEM, MENU, MODE_ATTRIBUTE, OWN_ITEM, PRICE_MODE, WATCHED, type GridState } from './sort-dom';
import { decorateMenu, isPriceMode, reflectLabel, sortTrigger } from './sort-menu';

const STALL_MS = 15000;

export interface SortHost {
  request: () => void;
  later: (run: () => void, ms: number) => void;
  schedule: () => void;
}

export interface PriceSort {
  sync: (db: Database, settings: Pick<Settings, 'commission'>) => void;
  click: (event: Event) => void;
  loaded: (event: Event) => void;
}

export function touchesSort(mutations: Iterable<MutationRecord>): boolean {
  for (const { target, addedNodes } of mutations) {
    const owner = target instanceof Element ? target : target.parentElement;
    if (owner?.closest(WATCHED)) return true;
    for (const node of addedNodes) if (node instanceof Element && (node.matches(WATCHED) || node.querySelector(WATCHED))) return true;
  }
  return false;
}

export function createPriceSort(doc: Document, host: SortHost): PriceSort {
  let loading = false;
  let triedAt: string | null = null;

  const keyNow = (): string => inspectGrid(doc)?.key ?? '';

  const watch = (seen: string): void =>
    host.later(() => {
      if (!loading) return;
      const now = keyNow();
      if (now !== seen) return watch(now);
      loading = false;
      triedAt = now;
      host.schedule();
    }, STALL_MS);

  function startLoad(seen: string): void {
    loading = true;
    triedAt = seen;
    watch(seen);
    host.request();
  }

  function resolve(view: GridView): GridState {
    if (!view.pending) return 'ready';
    if (loading) return 'loading';
    if (triedAt === view.key) return 'partial';
    startLoad(view.key);
    return 'loading';
  }

  function release(view: GridView | null): void {
    reflectLabel(doc, 'off');
    if (!view) return;
    markState(view.grid, null);
    clearOrder(view.cards);
  }

  function show(view: GridView, state: GridState, db: Database, commission: boolean): void {
    markState(view.grid, state);
    reflectLabel(doc, state === 'partial' ? 'partial' : 'price');
    if (state === 'loading') clearOrder(view.cards);
    else orderCards(view.cards, db, commission, doc.querySelector(DIRECTION_ASCENDING) === null);
  }

  function choose(filters: Element): void {
    filters.setAttribute(MODE_ATTRIBUTE, PRICE_MODE);
    triedAt = null;
    sortTrigger(doc)?.click();
    host.schedule();
  }

  return {
    sync(db, { commission }) {
      const filters = doc.querySelector(FILTERS);
      if (!filters) return;
      const on = isPriceMode(filters);
      decorateMenu(doc, on);
      const view = inspectGrid(doc);
      if (!on) return release(view);
      if (view) show(view, resolve(view), db, commission);
      else reflectLabel(doc, 'price');
    },
    click(event) {
      const filters = doc.querySelector(FILTERS);
      const item = event.target instanceof Element ? event.target.closest(`${MENU} ${ITEM}`) : null;
      if (!filters || !item) return;
      if (item.matches(OWN_ITEM)) {
        if (event.target instanceof HTMLInputElement) choose(filters);
      } else if (isPriceMode(filters)) {
        filters.removeAttribute(MODE_ATTRIBUTE);
        host.schedule();
      }
    },
    loaded(event) {
      const outcome = readLoaded(event);
      if (outcome === null) return;
      loading = false;
      if (outcome === 'partial') triedAt = keyNow();
      host.schedule();
    },
  };
}
