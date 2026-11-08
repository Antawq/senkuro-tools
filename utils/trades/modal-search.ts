import { isHiddenBySearch, normalizeText, rowSearchText, searchWordsOf } from '../shared/card-search';
import { element } from '../shared/dom';
import { SEARCH_CLASS } from '../shared/modal-filter-nodes';
import { closeIcon, searchIcon } from '../shared/svg';
import { createToolbarControls } from '../shared/toolbar-controls';
import { MODAL_REFRESH_CLASS } from './modal-refresh';

export { isHiddenBySearch, normalizeText, rowSearchText, searchWordsOf };

export const EMPTY_SEARCH_TEXT = 'Персонаж не найден';

const TRIGGER_CLASS = `${SEARCH_CLASS}__trigger`;
const BOX_CLASS = `${SEARCH_CLASS}__box`;
const INPUT_CLASS = `${SEARCH_CLASS}__input`;
const CLOSE_CLASS = `${SEARCH_CLASS}__close`;
const CLEAR_CLASS = `${SEARCH_CLASS}__clear`;
const OPEN_CLASS = `${SEARCH_CLASS}--open`;
const SITE_ICON_BUTTON = 'button button--secondary button--icon button-size--md';
const ICON_SIZE_PX = 20;
const SMALL_ICON_SIZE_PX = 16;
const LATER_CONTROLS = [`.${MODAL_REFRESH_CLASS}`];

export const SEARCH_TEXT = {
  open: 'Поиск персонажа',
  field: 'Имя персонажа',
  placeholder: 'Имя персонажа...',
  clear: 'Очистить',
  close: 'Закрыть поиск',
} as const;

export interface SearchView {
  query: string;
  isOpen: boolean;
}

export interface SearchHost {
  change: (query: string) => void;
  toggle: (isOpen: boolean) => void;
}

interface SearchControl {
  wrapper: HTMLElement;
  trigger: HTMLButtonElement;
  box: HTMLElement;
  input: HTMLInputElement;
  clear: HTMLButtonElement;
}

const controls = createToolbarControls<SearchControl>();

function createIconButton(className: string, label: string, icon: SVGSVGElement): HTMLButtonElement {
  const button = element('button', className);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  return button;
}

function createInput(): HTMLInputElement {
  const input = element('input', INPUT_CLASS);
  input.type = 'text';
  input.placeholder = SEARCH_TEXT.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', SEARCH_TEXT.field);
  return input;
}

function showView({ wrapper, trigger, box, input, clear }: SearchControl, view: SearchView): void {
  wrapper.classList.toggle(OPEN_CLASS, view.isOpen);
  trigger.hidden = view.isOpen;
  box.hidden = !view.isOpen;
  clear.hidden = view.query === '';
  if (input.value !== view.query) input.value = view.query;
}

function handleKeydown(control: SearchControl, host: SearchHost, event: KeyboardEvent): void {
  if (event.key !== 'Escape' || control.box.hidden) return;
  event.preventDefault();
  event.stopPropagation();
  if (control.input.value !== '') return host.change('');
  host.toggle(false);
  control.trigger.focus();
}

function createControl(host: SearchHost): SearchControl {
  const wrapper = element('div', SEARCH_CLASS);
  const trigger = createIconButton(`${SITE_ICON_BUTTON} ${TRIGGER_CLASS}`, SEARCH_TEXT.open, searchIcon(ICON_SIZE_PX));
  const box = element('div', BOX_CLASS);
  const close = createIconButton(CLOSE_CLASS, SEARCH_TEXT.close, searchIcon(SMALL_ICON_SIZE_PX));
  const input = createInput();
  const clear = createIconButton(CLEAR_CLASS, SEARCH_TEXT.clear, closeIcon(SMALL_ICON_SIZE_PX));
  const control: SearchControl = { wrapper, trigger, box, input, clear };
  trigger.addEventListener('click', () => {
    host.toggle(true);
    input.focus();
  });
  close.addEventListener('click', () => {
    host.change('');
    host.toggle(false);
    trigger.focus();
  });
  clear.addEventListener('click', () => {
    host.change('');
    input.focus();
  });
  input.addEventListener('input', () => host.change(input.value));
  wrapper.addEventListener('keydown', (event) => handleKeydown(control, host, event));
  box.append(close, input, clear);
  wrapper.append(trigger, box);
  return control;
}

export function syncSearchControl(toolbar: Element, view: SearchView, host: SearchHost): void {
  showView(
    controls.place(toolbar, () => createControl(host), LATER_CONTROLS),
    view
  );
}

export const removeSearchControl = (toolbar: Element): void => controls.remove(toolbar);
