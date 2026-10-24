import { element } from '../shared/dom';
import { MODAL_REFRESH_CLASS } from './modal-refresh';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';
import { CATALOG_STEP, HEADER, MODAL, RESULTS_CLASS } from './trade-modal';

const PICKER = '.modal-trade__body';
const SHARD_ROW = '.card-collect-preview--shard';
const WINDOWS_WITHOUT_SHARDS = ['для переплавки', 'для раскола', CATALOG_STEP];

const SWITCH = 'senkutools-shard-switch';
const SWITCH_BUTTON = `${SWITCH}__button`;
const EMPTY_NOTE = `${SWITCH}__empty`;
const OWN_NODES = `.${SWITCH}, .${EMPTY_NOTE}, .${MODAL_REFRESH_CLASS}`;
const ROW = 'card-collect-preview';
const PAGING_MARGIN_PX = 250;
const PARKED_ATTRIBUTE = 'data-senkutools-paging-parked';
const PARKED_FRAMES = 2;
const VIEW_ATTRIBUTE = 'data-senkutools-shard-view';
const SITE_SEGMENT = 'tabs tabs--segment';
const SITE_SEGMENT_INNER = 'tabs-inner';
const SITE_SEGMENT_CONTENT = 'tabs-cnt';
const SITE_TAB = 'button button--secondary button--auto button-size--md button--flat tabs-tab';
const SITE_TAB_ACTIVE = 'tabs-tab--active';
const GROUP_LABEL = 'Что показывать';

export type ShardView = 'all' | 'cards' | 'shards';

const VIEW_LABELS: Record<ShardView, string> = { all: 'Все', cards: 'Карты', shards: 'Осколки' };

const VIEWS = Object.keys(VIEW_LABELS) as ShardView[];

const EMPTY_TEXTS: Partial<Record<ShardView, string>> = { cards: 'Нет карт', shards: 'Нет осколков' };

const viewsByModal = new WeakMap<Element, ShardView>();

const parkedStates = new WeakMap<Element, string>();

interface ShardSwitchHost {
  nextFrame: (run: () => void) => void;
}

const childWithClass = (parent: Element, className: string): HTMLElement | undefined =>
  [...parent.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(className));

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
  const hasMorePages = [...results.children].some((child) => !child.classList.contains(ROW));
  const shownRows = [...results.querySelectorAll(`.${ROW}`)].filter((row) => row.matches(SHARD_ROW) === wantsShards);
  return shownRows.length === 0 && !hasMorePages ? (EMPTY_TEXTS[view] ?? null) : null;
};

const findSentinel = (results: Element): HTMLElement | undefined =>
  [...results.children].find((child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains(ROW));

const waitFrames = (count: number, run: () => void) => {
  if (count <= 0) run();
  else requestAnimationFrame(() => waitFrames(count - 1, run));
};

const retriggerPaging = (results: Element, picker: Element, view: ShardView) => {
  const sentinel = findSentinel(results);
  if (view === 'all' || !sentinel) return;
  const state = `${view}:${results.querySelectorAll(`.${ROW}`).length}`;
  if (parkedStates.get(results) === state) return;
  if (sentinel.getBoundingClientRect().top > picker.getBoundingClientRect().bottom + PAGING_MARGIN_PX) return;
  parkedStates.set(results, state);
  sentinel.setAttribute(PARKED_ATTRIBUTE, '');
  waitFrames(PARKED_FRAMES, () => sentinel.removeAttribute(PARKED_ATTRIBUTE));
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

const syncPicker = (modal: Element, picker: HTMLElement) => {
  const results = childWithClass(picker, RESULTS_CLASS);
  const existing = childWithClass(picker, SWITCH);
  if (!results || (results.querySelector(SHARD_ROW) === null && !canListShards(modal))) {
    existing?.remove();
    childWithClass(picker, EMPTY_NOTE)?.remove();
    picker.removeAttribute(VIEW_ATTRIBUTE);
    return;
  }
  const view = viewsByModal.get(modal) ?? 'all';
  const shardSwitch =
    existing ??
    createShardSwitch(view, (next) => {
      viewsByModal.set(modal, next);
      syncPicker(modal, picker);
    });
  const note = childWithClass(picker, EMPTY_NOTE);
  if (results.previousElementSibling !== (note ?? shardSwitch)) {
    results.before(shardSwitch);
    if (note) shardSwitch.after(note);
  }
  markActive(shardSwitch, view);
  syncEmptyNote(picker, shardSwitch, emptyTextOf(results, view));
  if (view === 'all') picker.removeAttribute(VIEW_ATTRIBUTE);
  else picker.setAttribute(VIEW_ATTRIBUTE, view);
  retriggerPaging(results, picker, view);
};

export function updateShardSwitches(pageDocument: Document = document): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) {
    for (const picker of modal.querySelectorAll<HTMLElement>(PICKER)) syncPicker(modal, picker);
  }
}

export const isPickerMutation = createMutationFilter(MODAL, OWN_NODES);

export const createShardSwitchWatcher = ({ nextFrame }: ShardSwitchHost) => createFrameWatcher(isPickerMutation, () => updateShardSwitches(), nextFrame);
