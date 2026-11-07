import type { FilterMemory, MemoryPlace, PlaceMemory } from '../shared/filter-memory';
import { MENU, MENU_ITEM } from './sort-dom';
import { FILTER_BODY, directionButtonOf, isResetClick, readDirection, readDropdown, readTab } from './site-controls';
import { findClickedPlace, memoryPlaceOf } from './sort-places';

export interface MemoryCaptureHost {
  nextFrame: (run: () => void) => void;
}

export interface MemoryCapture {
  handleClick: (event: Event) => void;
  touch: (toolbar: Element) => void;
  hasTouched: (toolbar: Element) => boolean;
}

interface Capture {
  pageDocument: Document;
  memory: FilterMemory;
  host: MemoryCaptureHost;
  touched: WeakSet<Element>;
}

const FILTER_TRIGGERS = '[aria-describedby="trade-filter"][data-popper-shown], [aria-describedby="cards-browse-filter"][data-popper-shown]';
const TOOLBARS = '.user-card__filters, .card-browse__form, .modal-trade__header-form';
const TAB = '.tabs-tab';
const TAB_AREA = 'section';
const GRID_TOOLBAR = '.user-card__filters';

function note(capture: Capture, toolbar: Element, read: (place: MemoryPlace) => Partial<PlaceMemory>): void {
  capture.touched.add(toolbar);
  const place = memoryPlaceOf(toolbar);
  if (!place || !capture.memory.isLoaded()) return;
  capture.host.nextFrame(() => {
    const patch = read(place);
    if (Object.keys(patch).length > 0) capture.memory.update(place, patch);
  });
}

function captureSort(capture: Capture, target: Element): void {
  const input = target.closest(`${MENU} ${MENU_ITEM}`)?.querySelector<HTMLInputElement>('input');
  const toolbar = findClickedPlace(capture.pageDocument)?.place.toolbar;
  if (!input?.value || !toolbar) return;
  note(capture, toolbar, () => ({ sort: input.value }));
}

function captureDirection(capture: Capture, target: Element): void {
  const toolbar = target.closest(TOOLBARS);
  const button = target.closest('button');
  if (!toolbar || !button || directionButtonOf(toolbar) !== button) return;
  note(capture, toolbar, () => ({ direction: readDirection(toolbar) }));
}

function mergedColors(previous: readonly string[], shown: readonly string[], active: readonly string[]): string[] {
  return [...active, ...previous.filter((color) => !shown.includes(color))];
}

function readFilterPatch(capture: Capture, place: MemoryPlace, isReset: boolean): Partial<PlaceMemory> {
  const body = capture.pageDocument.querySelector(FILTER_BODY);
  if (!body) return {};
  const state = readDropdown(body);
  const saved = capture.memory.get(place);
  const colors = isReset ? [] : mergedColors(saved ? saved.colors : [], state.shownColors, state.colors);
  return { ranks: state.ranks, colors, isAnimated: state.isAnimated, isExplicit: state.isExplicit };
}

function captureFilters(capture: Capture, target: Element): void {
  if (!target.closest('#trade-filter, #cards-browse-filter')) return;
  const toolbar = capture.pageDocument.querySelector(FILTER_TRIGGERS)?.closest(TOOLBARS);
  if (!toolbar || target.closest('button')?.matches('.dropdown-filter__actions button:last-child')) return;
  const isReset = isResetClick(target);
  note(capture, toolbar, (place) => readFilterPatch(capture, place, isReset));
}

function captureTab(capture: Capture, target: Element): void {
  const tab = target.closest(TAB);
  const toolbar = tab?.closest(TAB_AREA)?.querySelector(GRID_TOOLBAR);
  if (!tab || !toolbar) return;
  note(capture, toolbar, () => ({ tab: readTab(toolbar) }));
}

export function createMemoryCapture(pageDocument: Document, memory: FilterMemory, host: MemoryCaptureHost): MemoryCapture {
  const capture: Capture = { pageDocument, memory, host, touched: new WeakSet() };
  return {
    handleClick(event) {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const toolbar = event.target.closest(TOOLBARS);
      if (toolbar) capture.touched.add(toolbar);
      captureSort(capture, event.target);
      captureDirection(capture, event.target);
      captureFilters(capture, event.target);
      captureTab(capture, event.target);
    },
    touch: (toolbar) => void capture.touched.add(toolbar),
    hasTouched: (toolbar) => capture.touched.has(toolbar),
  };
}
