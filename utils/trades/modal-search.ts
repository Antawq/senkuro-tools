import { CARD_LINK, findShownName, slugFromHref } from '../shared/cards';
import type { Database } from '../shared/database';
import { element, placeBeforeAny } from '../shared/dom';
import { closeIcon, searchIcon } from '../shared/svg';
import { MODAL_REFRESH_CLASS } from './modal-refresh';

export const SEARCH_CLASS = 'senkutools-modal-search';
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

const controls = new WeakMap<Element, SearchControl>();

export const normalizeText = (text: string): string => text.toLowerCase().replaceAll('ё', 'е');

export const searchWordsOf = (query: string): string[] => normalizeText(query).split(/\s+/).filter(Boolean);

export function rowSearchText(row: Element, database: Database): string {
  const link = row.querySelector<HTMLAnchorElement>(CARD_LINK);
  const slug = slugFromHref(link?.getAttribute('href'));
  const entry = slug ? database[slug] : undefined;
  const sources = [entry?.name, entry?.manga, link ? findShownName(link) : null, slug?.replaceAll('-', ' ')];
  return normalizeText(sources.filter(Boolean).join(' '));
}

export function isHiddenBySearch(words: readonly string[], row: Element, database: Database): boolean {
  if (words.length === 0) return false;
  const text = rowSearchText(row, database);
  return !words.every((word) => text.includes(word));
}

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

function handleInputKeydown(control: SearchControl, host: SearchHost, event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
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
  input.addEventListener('keydown', (event) => handleInputKeydown(control, host, event));
  box.append(close, input, clear);
  wrapper.append(trigger, box);
  return control;
}

export function syncSearchControl(toolbar: Element, view: SearchView, host: SearchHost): void {
  let control = controls.get(toolbar);
  if (!control) {
    control = createControl(host);
    controls.set(toolbar, control);
  }
  placeBeforeAny(toolbar, control.wrapper, LATER_CONTROLS);
  showView(control, view);
}

export function removeSearchControl(toolbar: Element): void {
  controls.get(toolbar)?.wrapper.remove();
  controls.delete(toolbar);
}
