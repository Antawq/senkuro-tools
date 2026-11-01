import { CARD_ROW_CLASS } from '../shared/cards';
import { childWithClass, element } from '../shared/dom';
import { isListComplete, retriggerPaging } from '../shared/paging-sentinel';
import { PRICE_FILTER_NODES } from '../shared/price-filter-nodes';
import { CATALOG_STEP, HEADER, MODAL, PICKER, RESULTS_CLASS } from '../shared/trade-modal';
import { MODAL_REFRESH_CLASS } from './modal-refresh';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';

const SHARD_ROW = '.card-collect-preview--shard';
const WINDOWS_WITHOUT_SHARDS = ['для переплавки', 'для раскола', CATALOG_STEP];

const SWITCH = 'senkutools-shard-switch';
const SWITCH_BUTTON = `${SWITCH}__button`;
const EMPTY_NOTE = `${SWITCH}__empty`;
const OWN_NODES = `.${SWITCH}, .${EMPTY_NOTE}, .${MODAL_REFRESH_CLASS}, ${PRICE_FILTER_NODES}`;
const VIEW_ATTRIBUTE = 'data-senkutools-shard-view';
const SITE_SEGMENT = 'tabs tabs--segment';
const SITE_SEGMENT_INNER = 'tabs-inner';
const SITE_SEGMENT_CONTENT = 'tabs-cnt';
const SITE_TAB = 'button button--secondary button--auto button-size--md button--flat tabs-tab';
const SITE_TAB_ACTIVE = 'tabs-tab--active';
const GROUP_LABEL = 'Что показывать';

type ShardView = 'all' | 'cards' | 'shards';

const VIEW_LABELS: Record<ShardView, string> = { all: 'Все', cards: 'Карты', shards: 'Осколки' };

const VIEWS = Object.keys(VIEW_LABELS) as ShardView[];

const EMPTY_TEXTS: Partial<Record<ShardView, string>> = { cards: 'Нет карт', shards: 'Нет осколков' };

const viewsByModal = new WeakMap<Element, ShardView>();

interface ShardSwitchHost {
  nextFrame: (run: () => void) => void;
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
  return isViewEmpty && isListComplete(results) ? (EMPTY_TEXTS[view] ?? null) : null;
};

const canListShards = (modal: Element): boolean => {
  const header = modal.querySelector(HEADER)?.textContent ?? '';
  return header.trim() !== '' && !WINDOWS_WITHOUT_SHARDS.some((phrase) => header.includes(phrase));
};

const syncEmptyNote = (picker: HTMLElement, shardSwitch: Element, text: string | null) => {
  const note = childWithClass(picker, EMPTY_NOTE);
  if (text === null) note?.remove();
  else if (note) note.textContent = text;
  else shardSwitch.after(element('div', EMPTY_NOTE, text));
};

const clearShardSwitch = (picker: HTMLElement) => {
  childWithClass(picker, SWITCH)?.remove();
  childWithClass(picker, EMPTY_NOTE)?.remove();
  picker.removeAttribute(VIEW_ATTRIBUTE);
};

const placeShardSwitch = (picker: HTMLElement, results: Element, shardSwitch: Element) => {
  const note = childWithClass(picker, EMPTY_NOTE);
  if (results.previousElementSibling === (note ?? shardSwitch)) return;
  results.before(shardSwitch);
  if (note) shardSwitch.after(note);
};

const showView = (picker: HTMLElement, results: Element, view: ShardView) => {
  if (view === 'all') return picker.removeAttribute(VIEW_ATTRIBUTE);
  picker.setAttribute(VIEW_ATTRIBUTE, view);
  retriggerPaging(results);
};

const syncPicker = (modal: Element, picker: HTMLElement) => {
  const results = childWithClass(picker, RESULTS_CLASS);
  if (!results || (results.querySelector(SHARD_ROW) === null && !canListShards(modal))) return clearShardSwitch(picker);
  const view = viewsByModal.get(modal) ?? 'all';
  const shardSwitch =
    childWithClass(picker, SWITCH) ??
    createShardSwitch(view, (next) => {
      viewsByModal.set(modal, next);
      syncPicker(modal, picker);
    });
  placeShardSwitch(picker, results, shardSwitch);
  markActive(shardSwitch, view);
  syncEmptyNote(picker, shardSwitch, emptyTextOf(results, view));
  showView(picker, results, view);
};

export function updateShardSwitches(pageDocument: Document = document): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) {
    for (const picker of modal.querySelectorAll<HTMLElement>(PICKER)) syncPicker(modal, picker);
  }
}

export const isPickerMutation = createMutationFilter(MODAL, OWN_NODES);

export const createShardSwitchWatcher = ({ nextFrame }: ShardSwitchHost) => createFrameWatcher(isPickerMutation, () => updateShardSwitches(), nextFrame);
