import { CARD_ROW_CLASS } from '../shared/cards';
import { childWithClass, element, writeAttribute } from '../shared/dom';
import { isListComplete, retriggerPaging } from '../shared/paging-sentinel';
import { MODAL_FILTER_NODES } from '../shared/modal-filter-nodes';
import { PRICE_FILTER_NODES } from '../shared/price-filter-nodes';
import { CATALOG_STEP, HEADER, MODAL, PICKER, RESULTS_CLASS } from '../shared/trade-modal';
import { MODAL_REFRESH_CLASS } from './modal-refresh';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';

const SHARD_ROW = '.card-collect-preview--shard';
const WINDOWS_WITHOUT_SHARDS = ['для переплавки', 'для раскола', CATALOG_STEP];

const SWITCH = 'senkutools-shard-switch';
const SWITCH_BUTTON = `${SWITCH}__button`;
export const SHARD_NOTE_CLASS = `${SWITCH}__empty`;
const OWN_NODES = `.${SWITCH}, .${SHARD_NOTE_CLASS}, .${MODAL_REFRESH_CLASS}, ${PRICE_FILTER_NODES}, ${MODAL_FILTER_NODES}`;
export const SHARD_VIEW_ATTRIBUTE = 'data-senkutools-shard-view';
const SITE_SEGMENT = 'tabs tabs--segment';
const SITE_SEGMENT_INNER = 'tabs-inner';
const SITE_SEGMENT_CONTENT = 'tabs-cnt';
const SITE_TAB = 'button button--secondary button--auto button-size--md button--flat tabs-tab';
const SITE_TAB_ACTIVE = 'tabs-tab--active';
const GROUP_LABEL = 'Что показывать';

export type ShardView = 'all' | 'cards' | 'shards';

const VIEW_LABELS: Record<ShardView, string> = { all: 'Все', cards: 'Карты', shards: 'Осколки' };

const VIEWS = Object.keys(VIEW_LABELS) as ShardView[];

const EMPTY_TEXTS: Record<ShardView, string | null> = { all: null, cards: 'Нет карт', shards: 'Нет осколков' };

const viewsByModal = new WeakMap<Element, ShardView>();

export type ShardSelect = (modal: Element, view: ShardView) => void;

interface ShardSwitchHost {
  nextFrame: (run: () => void) => void;
  onSelect?: ShardSelect;
}

const markActive = (shardSwitch: Element, view: ShardView) => {
  for (const button of shardSwitch.querySelectorAll<HTMLButtonElement>(`.${SWITCH_BUTTON}`)) {
    const isActive = button.dataset.senkutoolsShardOption === view;
    button.classList.toggle(SITE_TAB_ACTIVE, isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
};

const createShardSwitch = (view: ShardView, select: (next: ShardView) => void): HTMLElement => {
  const shardSwitch = element('div', `${SWITCH} ${SITE_SEGMENT}`);
  shardSwitch.setAttribute('role', 'group');
  shardSwitch.setAttribute('aria-label', GROUP_LABEL);
  const inner = element('div', SITE_SEGMENT_INNER);
  const content = element('div', SITE_SEGMENT_CONTENT);
  for (const option of VIEWS) {
    const button = element('button', `${SWITCH_BUTTON} ${SITE_TAB}`);
    button.type = 'button';
    button.dataset.senkutoolsShardOption = option;
    button.append(element('span', undefined, VIEW_LABELS[option]));
    button.addEventListener('click', () => select(option));
    content.append(button);
  }
  inner.append(content);
  shardSwitch.append(inner);
  markActive(shardSwitch, view);
  return shardSwitch;
};

const emptyTextOf = (results: Element, view: ShardView): string | null => {
  const wantsShards = view === 'shards';
  const rows = [...results.querySelectorAll(`.${CARD_ROW_CLASS}`)];
  const isViewEmpty = rows.length > 0 && rows.every((row) => row.matches(SHARD_ROW) !== wantsShards);
  return isViewEmpty && isListComplete(results) ? EMPTY_TEXTS[view] : null;
};

export const isShardHidden = (picker: Element, row: Element): boolean => {
  const view = picker.getAttribute(SHARD_VIEW_ATTRIBUTE);
  if (view === 'cards') return row.matches(SHARD_ROW);
  return view === 'shards' && !row.matches(SHARD_ROW);
};

const canListShards = (modal: Element): boolean => {
  const header = modal.querySelector(HEADER)?.textContent ?? '';
  return header.trim() !== '' && !WINDOWS_WITHOUT_SHARDS.some((phrase) => header.includes(phrase));
};

const syncEmptyNote = (picker: HTMLElement, shardSwitch: Element, text: string | null) => {
  const note = childWithClass(picker, SHARD_NOTE_CLASS);
  if (text === null) note?.remove();
  else if (note) note.textContent = text;
  else shardSwitch.after(element('div', SHARD_NOTE_CLASS, text));
};

const clearShardSwitch = (picker: HTMLElement) => {
  childWithClass(picker, SWITCH)?.remove();
  childWithClass(picker, SHARD_NOTE_CLASS)?.remove();
  picker.removeAttribute(SHARD_VIEW_ATTRIBUTE);
};

const placeShardSwitch = (picker: HTMLElement, results: Element, shardSwitch: Element) => {
  const note = childWithClass(picker, SHARD_NOTE_CLASS);
  if (results.previousElementSibling === (note ?? shardSwitch)) return;
  results.before(shardSwitch);
  if (note) shardSwitch.after(note);
};

const showView = (picker: HTMLElement, results: Element, view: ShardView) => {
  writeAttribute(picker, SHARD_VIEW_ATTRIBUTE, view === 'all' ? null : view);
  if (view === 'all') return;
  retriggerPaging(results);
};

const syncPicker = (modal: Element, picker: HTMLElement, onSelect?: ShardSelect) => {
  const results = childWithClass(picker, RESULTS_CLASS);
  if (!results || (results.querySelector(SHARD_ROW) === null && !canListShards(modal))) return clearShardSwitch(picker);
  const view = viewsByModal.get(modal) ?? 'all';
  const shardSwitch =
    childWithClass(picker, SWITCH) ??
    createShardSwitch(view, (next) => {
      viewsByModal.set(modal, next);
      syncPicker(modal, picker, onSelect);
      onSelect?.(modal, next);
    });
  placeShardSwitch(picker, results, shardSwitch);
  markActive(shardSwitch, view);
  syncEmptyNote(picker, shardSwitch, emptyTextOf(results, view));
  showView(picker, results, view);
};

export function updateShardSwitches(pageDocument: Document = document, onSelect?: ShardSelect): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) {
    for (const picker of modal.querySelectorAll<HTMLElement>(PICKER)) syncPicker(modal, picker, onSelect);
  }
}

export function applyShardView(toolbar: Element, view: ShardView, onSelect?: ShardSelect): void {
  const modal = toolbar.closest(MODAL);
  if (!modal) return;
  viewsByModal.set(modal, view);
  for (const picker of modal.querySelectorAll<HTMLElement>(PICKER)) syncPicker(modal, picker, onSelect);
}

export const isPickerMutation = createMutationFilter(MODAL, OWN_NODES);

export const createShardSwitchWatcher = ({ nextFrame, onSelect }: ShardSwitchHost) => ({
  ...createFrameWatcher(isPickerMutation, () => updateShardSwitches(document, onSelect), nextFrame),
  applyView: (toolbar: Element, view: ShardView) => applyShardView(toolbar, view, onSelect),
});
