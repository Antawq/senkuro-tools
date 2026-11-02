import { element, writeAttribute } from '../shared/dom';
import { LOCK_FILTER_CLASS, SEARCH_CLASS } from '../shared/modal-filter-nodes';
import { lockIcon } from '../shared/svg';
import { createToolbarControls } from '../shared/toolbar-controls';
import { createPanelShell, setPanelOpen } from '../shared/toolbar-panel';
import { MODAL_REFRESH_CLASS } from './modal-refresh';

export const SITE_LOCK_PATH =
  'M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920t141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80zm240-200q33 0 56.5-23.5T560-360t-23.5-56.5T480-440t-56.5 23.5T400-360t23.5 56.5T480-280M360-640h240v-80q0-50-35-85t-85-35-85 35-35 85z';

const TRIGGER_CLASS = `${LOCK_FILTER_CLASS}__trigger`;
const PANEL_CLASS = `${LOCK_FILTER_CLASS}__panel`;
const LOCK_PATHS = ':scope > .card-collect-preview__status path';
const SITE_ICON_BUTTON = 'button button--secondary button--icon button-size--md';
const SITE_APPLIED = 'button--chip';
const ICON_SIZE_PX = 20;
const ARROW_STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
const LATER_CONTROLS = [`.${SEARCH_CLASS}`, `.${MODAL_REFRESH_CLASS}`];

export type LockView = 'all' | 'unlocked' | 'locked';

export const LOCK_CAPTION = 'Замок';

export const LOCK_LABELS: Record<LockView, string> = { all: 'Все карты', unlocked: 'Без замка', locked: 'С замком' };

export const LOCK_TITLES: Record<LockView, string> = {
  all: 'Фильтр замка: Все карты',
  unlocked: 'Фильтр замка: Без замка',
  locked: 'Фильтр замка: С замком',
};

export const EMPTY_LOCK_TEXTS: Record<Exclude<LockView, 'all'>, string> = {
  unlocked: 'Нет доступных карт (все заблокированы)',
  locked: 'Нет заблокированных карт',
};

const VIEWS = Object.keys(LOCK_LABELS) as LockView[];

interface LockOption {
  label: HTMLElement;
  radio: HTMLInputElement;
}

interface LockControl {
  wrapper: HTMLElement;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  options: Record<LockView, LockOption>;
}

const controls = createToolbarControls<LockControl>();
let groupCount = 0;

export const isRowLocked = (row: Element): boolean => [...row.querySelectorAll(LOCK_PATHS)].some((path) => path.getAttribute('d') === SITE_LOCK_PATH);

export const isHiddenByLock = (view: LockView, row: Element): boolean => view !== 'all' && isRowLocked(row) === (view === 'unlocked');

function createOption(view: LockView, group: string): LockOption {
  const label = element('label', 'radio radio-size--md radio--list');
  label.tabIndex = 0;
  label.setAttribute('role', 'radio');
  const radio = element('input');
  radio.type = 'radio';
  radio.name = group;
  radio.value = view;
  const text = element('div', 'radio__label');
  text.append(element('span', undefined, LOCK_LABELS[view]));
  label.append(radio, text);
  return { label, radio };
}

function createMenu(group: string): { menu: HTMLElement; options: Record<LockView, LockOption> } {
  const menu = element('div', 'dropdown-menu dropdown-menu--sm');
  menu.setAttribute('role', 'radiogroup');
  menu.setAttribute('aria-label', LOCK_CAPTION);
  menu.append(element('div', 'dropdown-menu__caption', LOCK_CAPTION));
  const options = Object.fromEntries(VIEWS.map((view) => [view, createOption(view, group)])) as Record<LockView, LockOption>;
  menu.append(...VIEWS.map((view) => options[view].label));
  return { menu, options };
}

function createTrigger(): HTMLButtonElement {
  const trigger = element('button', `${SITE_ICON_BUTTON} ${TRIGGER_CLASS}`);
  trigger.type = 'button';
  trigger.setAttribute('aria-expanded', 'false');
  const icon = lockIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  trigger.append(icon);
  return trigger;
}

function openPanel({ panel, trigger, options }: LockControl): void {
  setPanelOpen(panel, trigger, true);
  for (const view of VIEWS) if (options[view].radio.checked) options[view].label.focus();
}

function closePanel({ panel, trigger }: LockControl): void {
  setPanelOpen(panel, trigger, false);
  trigger.focus();
}

function consume(event: KeyboardEvent, act: () => void): void {
  event.preventDefault();
  event.stopPropagation();
  act();
}

function neighbourOf(view: LockView, step: number): LockView {
  return VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length] as LockView;
}

function handleOptionKey(control: LockControl, view: LockView, event: KeyboardEvent): void {
  const step = ARROW_STEPS[event.key];
  if (event.key === 'Enter' || event.key === ' ') consume(event, () => control.options[view].radio.click());
  else if (step !== undefined) consume(event, () => control.options[neighbourOf(view, step)].label.focus());
}

function handleKeydown(control: LockControl, event: KeyboardEvent): void {
  if (control.panel.hidden) return;
  if (event.key === 'Escape') return consume(event, () => closePanel(control));
  const view = VIEWS.find((candidate) => control.options[candidate].label === event.target);
  if (view !== undefined) handleOptionKey(control, view, event);
}

function createControl(select: (view: LockView) => void): LockControl {
  groupCount += 1;
  const { menu, options } = createMenu(`${LOCK_FILTER_CLASS}-${groupCount}`);
  const wrapper = element('div', LOCK_FILTER_CLASS);
  const trigger = createTrigger();
  const panel = createPanelShell(PANEL_CLASS, menu);
  const control: LockControl = { wrapper, trigger, panel, options };
  trigger.addEventListener('click', () => (panel.hidden ? openPanel(control) : closePanel(control)));
  wrapper.addEventListener('keydown', (event) => handleKeydown(control, event));
  for (const view of VIEWS) {
    options[view].radio.addEventListener('change', () => {
      select(view);
      closePanel(control);
    });
  }
  wrapper.append(trigger, panel);
  return control;
}

function showView({ trigger, options }: LockControl, view: LockView): void {
  trigger.classList.toggle(SITE_APPLIED, view !== 'all');
  writeAttribute(trigger, 'title', LOCK_TITLES[view]);
  writeAttribute(trigger, 'aria-label', LOCK_TITLES[view]);
  for (const optionView of VIEWS) {
    options[optionView].radio.checked = optionView === view;
    writeAttribute(options[optionView].label, 'aria-checked', String(optionView === view));
  }
}

export function syncLockControl(toolbar: Element, view: LockView, select: (view: LockView) => void): void {
  showView(
    controls.place(toolbar, () => createControl(select), LATER_CONTROLS),
    view
  );
}

export const removeLockControl = (toolbar: Element): void => controls.remove(toolbar);
