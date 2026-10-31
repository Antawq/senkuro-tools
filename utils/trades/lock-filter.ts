import { element } from '../shared/dom';
import { lockIcon, lockOpenIcon } from '../shared/svg';
import { MODAL_REFRESH_CLASS } from './modal-refresh';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';
import { CATALOG_STEP, HEADER, MODAL, RESULTS_CLASS } from './trade-modal';

export const MODAL_LOCK_POPPER_CLASS = 'senkutools-modal-lock-popper';
export const MODAL_LOCK_CLASS = 'senkutools-modal-lock';
export const MODAL_LOCK_DROPDOWN_CLASS = 'senkutools-lock-dropdown';
export const EMPTY_LOCK_NOTE_CLASS = 'senkutools-lock-empty';

const TOOLBAR = '.modal-trade__header-form';
const PICKER = '.modal-trade__body';
const RESULTS = `.${RESULTS_CLASS}`;
const ROW = 'card-collect-preview';
const OWN_NODES = `.${MODAL_LOCK_POPPER_CLASS}, .${MODAL_LOCK_CLASS}, .${MODAL_LOCK_DROPDOWN_CLASS}, .${EMPTY_LOCK_NOTE_CLASS}`;
const VIEW_ATTRIBUTE = 'data-senkutools-lock-view';
const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const SITE_ACCENT = 'button--accent';
const SITE_SECONDARY = 'button--secondary';
const ICON_SIZE_PX = 20;
const PAGING_MARGIN_PX = 250;
const PARKED_ATTRIBUTE = 'data-senkutools-paging-parked';
const PARKED_FRAMES = 2;

export type LockView = 'all' | 'unlocked' | 'locked';

export interface LockOption {
  value: LockView;
  label: string;
}

export const LOCK_OPTIONS: readonly LockOption[] = [
  { value: 'all', label: 'Все карты' },
  { value: 'unlocked', label: 'Без замка' },
  { value: 'locked', label: 'С замком' },
];

export const LOCK_TITLES: Record<LockView, string> = {
  all: 'Фильтр замка: Все карты',
  unlocked: 'Фильтр замка: Без замка',
  locked: 'Фильтр замка: С замком',
};

const EMPTY_LOCK_TEXTS: Partial<Record<LockView, string>> = {
  unlocked: 'Нет доступных карт (все заблокированы)',
  locked: 'Нет заблокированных карт',
};

const viewsByModal = new WeakMap<Element, LockView>();
const parkedStates = new WeakMap<Element, string>();

export interface LockFilterHost {
  nextFrame: (run: () => void) => void;
}

const childWithClass = (parent: Element, className: string): HTMLElement | undefined =>
  [...parent.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(className));

export function isCardLocked(card: Element): boolean {
  if (
    card.classList.contains('card-collect-preview--locked') ||
    card.classList.contains('card-collect--locked') ||
    card.classList.contains('is-locked') ||
    card.getAttribute('data-locked') === 'true' ||
    card.getAttribute('data-senkutools-locked') === 'true'
  ) {
    return true;
  }
  if (
    card.querySelector(
      '.card-collect-preview__lock, .card-collect__lock, [class*="lock" i], [class*="locked" i], .card-collect-preview__status svg'
    ) !== null
  ) {
    return true;
  }
  const svgs = card.querySelectorAll('svg');
  for (const svg of svgs) {
    const d = svg.querySelector('path')?.getAttribute('d') ?? '';
    if (d.includes('M240-80') || d.includes('M240-640') || d.includes('M160-160') || d.includes('M360-640')) {
      return true;
    }
  }
  return false;
}

export function markLockedCards(results: Element): void {
  const cards = results.querySelectorAll<HTMLElement>(`.${ROW}, .modal-trade__card`);
  for (const card of cards) {
    const locked = isCardLocked(card);
    card.dataset.senkutoolsLocked = String(locked);
  }
}

let popperCounter = 0;

export function createLockFilterPopper(
  initialView: LockView = 'all',
  onChange: (nextView: LockView) => void
): HTMLElement {
  const popperId = `senkutools-lock-${++popperCounter}`;
  const popper = element('div', `v-popper ${MODAL_LOCK_POPPER_CLASS}`);

  const button = element('button', `${SITE_BUTTON} ${MODAL_LOCK_CLASS}`);
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');

  const dropdown = element('div', `v-popper__popper dropdown-menu dropdown-menu--sm ${MODAL_LOCK_DROPDOWN_CLASS}`);
  dropdown.hidden = true;
  dropdown.setAttribute('role', 'listbox');

  const caption = element('div', 'dropdown-menu__caption', 'Замок');
  dropdown.append(caption);

  let currentView: LockView = initialView;
  const radioInputs = new Map<LockView, HTMLInputElement>();
  const radioLabels = new Map<LockView, HTMLElement>();

  const updateVisuals = () => {
    button.replaceChildren();
    const icon = currentView === 'unlocked' ? lockOpenIcon(ICON_SIZE_PX) : lockIcon(ICON_SIZE_PX);
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);

    const isActive = currentView !== 'all';
    button.classList.toggle(SITE_ACCENT, isActive);
    button.classList.toggle(SITE_SECONDARY, !isActive);
    button.setAttribute('aria-pressed', String(isActive));
    button.setAttribute('title', LOCK_TITLES[currentView]);
    button.dataset.senkutoolsLockOption = currentView;

    for (const [view, input] of radioInputs) {
      input.checked = view === currentView;
      radioLabels.get(view)?.classList.toggle('is-active', view === currentView);
    }
  };

  const closeDropdown = () => {
    if (!dropdown.hidden) {
      dropdown.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  };

  const openDropdown = () => {
    if (dropdown.hidden) {
      dropdown.hidden = false;
      button.setAttribute('aria-expanded', 'true');
    }
  };

  const select = (view: LockView) => {
    const changed = currentView !== view;
    currentView = view;
    updateVisuals();
    closeDropdown();
    if (changed) {
      onChange(currentView);
    }
  };

  for (const opt of LOCK_OPTIONS) {
    const label = element('label', 'radio radio-size--md radio--list');
    label.dataset.value = opt.value;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = popperId;
    input.value = opt.value;
    input.checked = opt.value === currentView;

    const labelDiv = element('div', 'radio__label');
    const span = element('span', '', opt.label);
    labelDiv.append(span);

    label.append(input, labelDiv);

    label.addEventListener('click', (e) => {
      e.preventDefault();
      select(opt.value);
    });

    input.addEventListener('change', () => {
      if (input.checked) {
        select(opt.value);
      }
    });

    radioInputs.set(opt.value, input);
    radioLabels.set(opt.value, label);
    dropdown.append(label);
  }

  updateVisuals();

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.hidden) {
      openDropdown();
    } else {
      closeDropdown();
    }
  });

  const handleOutsideClick = (e: MouseEvent) => {
    if (!popper.isConnected) {
      document.removeEventListener('click', handleOutsideClick);
      return;
    }
    if (!popper.contains(e.target as Node)) {
      closeDropdown();
    }
  };
  document.addEventListener('click', handleOutsideClick);

  const handleKeydown = (e: KeyboardEvent) => {
    if (!popper.isConnected) {
      document.removeEventListener('keydown', handleKeydown);
      return;
    }
    if (e.key === 'Escape' && !dropdown.hidden) {
      closeDropdown();
      button.focus();
    }
  };
  document.addEventListener('keydown', handleKeydown);

  popper.append(button, dropdown);
  return popper;
}

export function createLockFilterButton(
  initialView: LockView,
  onChange: (nextView: LockView) => void,
  className?: string
): HTMLButtonElement {
  const popper = createLockFilterPopper(initialView, onChange);
  const button = popper.querySelector<HTMLButtonElement>(`.${MODAL_LOCK_CLASS}`)!;
  if (className) button.classList.add(className);
  return button;
}

const isUserCardsStep = (modal: Element): boolean =>
  modal.querySelector(RESULTS) !== null && !(modal.querySelector(HEADER)?.textContent ?? '').includes(CATALOG_STEP);

const findSentinel = (results: Element): HTMLElement | undefined =>
  [...results.children].find((child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains(ROW));

const waitFrames = (count: number, run: () => void) => {
  if (count <= 0) run();
  else requestAnimationFrame(() => waitFrames(count - 1, run));
};

const retriggerPaging = (results: Element, picker: Element, view: LockView) => {
  const sentinel = findSentinel(results);
  if (view === 'all' || !sentinel) return;
  const state = `${view}:${results.querySelectorAll(`.${ROW}`).length}`;
  if (parkedStates.get(results) === state) return;
  if (sentinel.getBoundingClientRect().top > picker.getBoundingClientRect().bottom + PAGING_MARGIN_PX) return;
  parkedStates.set(results, state);
  sentinel.setAttribute(PARKED_ATTRIBUTE, '');
  waitFrames(PARKED_FRAMES, () => sentinel.removeAttribute(PARKED_ATTRIBUTE));
};

const emptyTextOf = (results: Element, view: LockView): string | null => {
  if (view === 'all') return null;
  const cards = [...results.querySelectorAll<HTMLElement>(`.${ROW}, .modal-trade__card`)];
  const hasMorePages = [...results.children].some((child) => !child.classList.contains(ROW));
  if (cards.length === 0 || hasMorePages) return null;

  if (view === 'unlocked') {
    const allLocked = cards.every((card) => card.dataset.senkutoolsLocked === 'true');
    return allLocked ? (EMPTY_LOCK_TEXTS.unlocked ?? null) : null;
  }
  if (view === 'locked') {
    const noneLocked = cards.every((card) => card.dataset.senkutoolsLocked === 'false');
    return noneLocked ? (EMPTY_LOCK_TEXTS.locked ?? null) : null;
  }
  return null;
};

const syncEmptyNote = (picker: HTMLElement, text: string | null) => {
  const note = childWithClass(picker, EMPTY_LOCK_NOTE_CLASS);
  if (text === null) note?.remove();
  else if (note) note.textContent = text;
  else picker.append(element('div', EMPTY_LOCK_NOTE_CLASS, text));
};

export const syncPickerLock = (modal: Element, picker: HTMLElement) => {
  const results = childWithClass(picker, RESULTS_CLASS);
  if (!results) {
    childWithClass(picker, EMPTY_LOCK_NOTE_CLASS)?.remove();
    picker.removeAttribute(VIEW_ATTRIBUTE);
    return;
  }
  markLockedCards(results);

  const view = viewsByModal.get(modal) ?? 'all';
  if (view === 'all') picker.removeAttribute(VIEW_ATTRIBUTE);
  else picker.setAttribute(VIEW_ATTRIBUTE, view);

  syncEmptyNote(picker, emptyTextOf(results, view));
  retriggerPaging(results, picker, view);
};

export function syncModalLockButtons(pageDocument: Document = document): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) {
    const toolbar = modal.querySelector(TOOLBAR);
    const picker = modal.querySelector<HTMLElement>(PICKER);
    if (!toolbar || !picker) continue;

    const ownPopper = toolbar.querySelector<HTMLElement>(`:scope > .${MODAL_LOCK_POPPER_CLASS}`);
    if (!isUserCardsStep(modal)) {
      ownPopper?.remove();
      childWithClass(picker, EMPTY_LOCK_NOTE_CLASS)?.remove();
      picker.removeAttribute(VIEW_ATTRIBUTE);
      continue;
    }

    const refreshBtn = toolbar.querySelector(`:scope > .${MODAL_REFRESH_CLASS}`);
    const popper =
      ownPopper ??
      createLockFilterPopper(
        viewsByModal.get(modal) ?? 'all',
        (next) => {
          viewsByModal.set(modal, next);
          syncPickerLock(modal, picker);
        }
      );

    if (refreshBtn) {
      if (popper.nextElementSibling !== refreshBtn) refreshBtn.before(popper);
    } else {
      if (toolbar.lastElementChild !== popper) toolbar.append(popper);
    }

    syncPickerLock(modal, picker);
  }
}

export function updateLockFilters(pageDocument: Document = document): void {
  syncModalLockButtons(pageDocument);
}

export const isLockMutation = createMutationFilter(MODAL, OWN_NODES);

export const createLockFilterWatcher = ({ nextFrame }: LockFilterHost) =>
  createFrameWatcher(isLockMutation, () => updateLockFilters(), nextFrame);
