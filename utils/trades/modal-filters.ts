import { CARD_ROW_CLASS } from '../shared/cards';
import type { Database } from '../shared/database';
import { childWithClass, element, writeAttribute } from '../shared/dom';
import { FILTER_EMPTY_CLASS, MODAL_FILTER_NODES } from '../shared/modal-filter-nodes';
import { isListComplete, retriggerPaging } from '../shared/paging-sentinel';
import { PRICE_FILTER_NODES } from '../shared/price-filter-nodes';
import { MODAL, PICKER, RESULTS_CLASS, TOOLBAR, isPartnerStep, isUserCardsStep } from '../shared/trade-modal';
import { EMPTY_LOCK_TEXTS, isHiddenByLock, removeLockControl, syncLockControl, type LockView } from './lock-filter';
import { MODAL_REFRESH_CLASS } from './modal-refresh';
import { EMPTY_SEARCH_TEXT, isHiddenBySearch, removeSearchControl, searchWordsOf, syncSearchControl, type SearchHost } from './modal-search';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';
import { isShardHidden, SHARD_NOTE_CLASS } from './shard-switch';

const FILTERED_ATTRIBUTE = 'data-senkutools-filtered';
const OWN_NODES = `${MODAL_FILTER_NODES}, .${MODAL_REFRESH_CLASS}, ${PRICE_FILTER_NODES}`;

interface ModalFilters {
  lock: LockView;
  query: string;
  isSearchOpen: boolean;
}

export interface ModalFiltersHost {
  nextFrame: (run: () => void) => void;
  getDatabase: () => Database;
}

const filtersByModal = new WeakMap<Element, ModalFilters>();

const filtersOf = (modal: Element): ModalFilters => filtersByModal.get(modal) ?? { lock: 'all', query: '', isSearchOpen: false };

interface RowFilter {
  lock: LockView;
  words: readonly string[];
}

const rowFilterOf = (modal: Element, filters: ModalFilters): RowFilter => ({
  lock: isPartnerStep(modal) ? filters.lock : 'all',
  words: isUserCardsStep(modal) ? searchWordsOf(filters.query) : [],
});

const isRowFilterOn = ({ lock, words }: RowFilter): boolean => lock !== 'all' || words.length > 0;

function noteTextOf({ lock, words }: RowFilter): string | null {
  if (words.length > 0) return EMPTY_SEARCH_TEXT;
  return lock === 'all' ? null : EMPTY_LOCK_TEXTS[lock];
}

function syncNote(picker: HTMLElement, results: Element | undefined, text: string | null): void {
  const note = childWithClass(picker, FILTER_EMPTY_CLASS);
  if (!results || text === null) return note?.remove();
  if (!note) return results.after(element('div', FILTER_EMPTY_CLASS, text));
  if (note.textContent !== text) note.textContent = text;
  if (results.nextElementSibling !== note) results.after(note);
}

function isEmptyByFilters(picker: Element, results: Element, rows: readonly Element[]): boolean {
  const isFiltered = (row: Element) => row.hasAttribute(FILTERED_ATTRIBUTE);
  return (
    rows.some(isFiltered) &&
    rows.every((row) => isFiltered(row) || isShardHidden(picker, row)) &&
    isListComplete(results) &&
    childWithClass(picker, SHARD_NOTE_CLASS) === undefined
  );
}

function markRows(rows: readonly Element[], { lock, words }: RowFilter, database: Database): void {
  for (const row of rows) writeAttribute(row, FILTERED_ATTRIBUTE, isHiddenByLock(lock, row) || isHiddenBySearch(words, row, database) ? '' : null);
}

function syncRows(modal: Element, picker: HTMLElement, filters: ModalFilters, database: Database): void {
  const results = childWithClass(picker, RESULTS_CLASS);
  const rowFilter = rowFilterOf(modal, filters);
  const rows = results ? [...results.querySelectorAll(`:scope > .${CARD_ROW_CLASS}`)] : [];
  markRows(rows, rowFilter, database);
  const isEmpty = results !== undefined && isUserCardsStep(modal) && isEmptyByFilters(picker, results, rows);
  syncNote(picker, results, isEmpty ? noteTextOf(rowFilter) : null);
  if (results && isRowFilterOn(rowFilter)) retriggerPaging(results);
}

function syncControls(modal: Element, toolbar: Element, filters: ModalFilters, resync: () => void): void {
  const update = (patch: Partial<ModalFilters>) => {
    filtersByModal.set(modal, { ...filtersOf(modal), ...patch });
    resync();
  };
  const searchHost: SearchHost = { change: (query) => update({ query }), toggle: (isSearchOpen) => update({ isSearchOpen }) };
  if (isPartnerStep(modal)) syncLockControl(toolbar, filters.lock, (lock) => update({ lock }));
  else removeLockControl(toolbar);
  if (isUserCardsStep(modal)) syncSearchControl(toolbar, { query: filters.query, isOpen: filters.isSearchOpen }, searchHost);
  else removeSearchControl(toolbar);
}

export function syncModalFilters(pageDocument: Document, getDatabase: () => Database): void {
  const resync = () => syncModalFilters(pageDocument, getDatabase);
  for (const modal of pageDocument.querySelectorAll(MODAL)) {
    const filters = filtersOf(modal);
    const toolbar = modal.querySelector(TOOLBAR);
    const picker = modal.querySelector<HTMLElement>(PICKER);
    if (toolbar) syncControls(modal, toolbar, filters, resync);
    if (picker) syncRows(modal, picker, filters, getDatabase());
  }
}

export const isFilterMutation = createMutationFilter(MODAL, OWN_NODES);

export function createModalFiltersWatcher({ nextFrame, getDatabase }: ModalFiltersHost) {
  const sync = () => syncModalFilters(document, getDatabase);
  return { ...createFrameWatcher(isFilterMutation, sync, nextFrame), sync };
}
