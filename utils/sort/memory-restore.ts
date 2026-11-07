import type { FilterMemory, PlaceMemory } from '../shared/filter-memory';
import type { FrameWait } from '../shared/frame-wait';
import { MODAL } from '../shared/trade-modal';
import { applyFilters, chooseSort, chooseTab, filterTriggerOf, flipDirection, readDirection, sortTriggerOf } from './site-controls';
import { memoryPlaceOf } from './sort-places';

export interface MemoryRestoreHost {
  isReady: () => boolean;
  hasTouched: (toolbar: Element) => boolean;
  wait: FrameWait;
  restoreOwn: (toolbar: Element, saved: PlaceMemory) => void;
}

export interface MemoryRestore {
  sync: () => void;
}

const TOOLBARS = '.user-card__filters, .card-browse__form, .modal-trade__header-form';
const DEFAULT_SORT = 'CREATED_AT';
const PRICE_SORT = 'price';

const hasSiteFilters = (saved: PlaceMemory): boolean => Boolean(saved.ranks.length || saved.colors.length || saved.isAnimated || saved.isExplicit);

const isStillOurs = (host: MemoryRestoreHost, toolbar: Element): boolean => toolbar.isConnected && !host.hasTouched(toolbar);

function restoreQuickControls(toolbar: Element, saved: PlaceMemory): void {
  if (saved.tab === 'shards') chooseTab(toolbar, 'shards');
  if (saved.direction === 'ASC' && readDirection(toolbar) === 'DESC') flipDirection(toolbar);
}

const hasSiteSort = (saved: PlaceMemory): saved is PlaceMemory & { sort: string } =>
  saved.sort !== null && saved.sort !== DEFAULT_SORT && saved.sort !== PRICE_SORT;

async function restoreToolbar(
  pageDocument: Document,
  host: MemoryRestoreHost,
  toolbar: Element,
  saved: PlaceMemory,
  shouldRestoreSite: boolean
): Promise<void> {
  if (shouldRestoreSite) {
    restoreQuickControls(toolbar, saved);
    if (hasSiteSort(saved) && isStillOurs(host, toolbar)) await chooseSort(pageDocument, toolbar, saved.sort, host.wait);
    if (hasSiteFilters(saved) && isStillOurs(host, toolbar)) await applyFilters(pageDocument, toolbar, saved, host.wait);
  }
  if (isStillOurs(host, toolbar)) host.restoreOwn(toolbar, saved);
}

const hasControls = (toolbar: Element): boolean => sortTriggerOf(toolbar) !== null && filterTriggerOf(toolbar) !== null;

function claimSiteRestore(restoredModals: WeakSet<Element>, toolbar: Element): boolean {
  const modal = toolbar.closest(MODAL);
  if (!modal) return true;
  if (restoredModals.has(modal)) return false;
  restoredModals.add(modal);
  return true;
}

export function createMemoryRestore(pageDocument: Document, memory: FilterMemory, host: MemoryRestoreHost): MemoryRestore {
  const started = new WeakSet<Element>();
  const restoredModals = new WeakSet<Element>();
  return {
    sync() {
      if (!host.isReady() || !memory.isLoaded()) return;
      for (const toolbar of pageDocument.querySelectorAll(TOOLBARS)) {
        const place = memoryPlaceOf(toolbar);
        if (!place || started.has(toolbar) || !hasControls(toolbar) || host.hasTouched(toolbar)) continue;
        started.add(toolbar);
        const shouldRestoreSite = claimSiteRestore(restoredModals, toolbar);
        const saved = memory.get(place);
        if (saved)
          restoreToolbar(pageDocument, host, toolbar, saved, shouldRestoreSite).catch((error: unknown) =>
            console.error('SenkuTools: filter restore failed', error)
          );
      }
    },
  };
}
