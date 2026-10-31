import { element } from '../shared/dom';
import { PRICE_FILTER_CLASS } from '../shared/price-filter-nodes';
import { chevronIcon, closeIcon, priceTagIcon, resetIcon } from '../shared/svg';
import { createRange, formatBound, parseBound, type PriceRange } from './price-range';

const TRIGGER_CLASS = `${PRICE_FILTER_CLASS}__trigger`;
const PANEL_CLASS = `${PRICE_FILTER_CLASS}__panel`;
const FIELDS_CLASS = `${PRICE_FILTER_CLASS}__fields`;
const FIELD_CLASS = `${PRICE_FILTER_CLASS}__field`;
const INPUT_CLASS = `${PRICE_FILTER_CLASS}__input`;
const SITE_TRIGGER = 'button button--secondary button--auto button-size--md';
const SITE_ICON_BUTTON = 'button button--secondary button--icon button-size--md';
const SITE_APPLIED = 'button--chip';
const SITE_DROPDOWN = 'v-popper--theme-dropdown';
const OWN_PREFIX = 'senkutools-';
const ICON_SIZE_PX = 20;
const VIEWPORT_MARGIN_PX = 16;

export const RANGE_TEXT = {
  trigger: 'Цена',
  from: 'от',
  to: 'до',
} as const;

export const rangeLabelOf = (percent: number | null): string => (percent === null ? RANGE_TEXT.trigger : `${RANGE_TEXT.trigger} ${percent}%`);

export interface RangeView {
  label: string;
  range: PriceRange | null;
}

export type ApplyRange = (toolbar: Element, range: PriceRange | null) => void;

interface RangeControl {
  wrapper: HTMLElement;
  trigger: HTMLButtonElement;
  label: HTMLElement;
  panel: HTMLElement;
  minInput: HTMLInputElement;
  maxInput: HTMLInputElement;
}

const controls = new WeakMap<Element, RangeControl>();

function createIconButton(icon: SVGSVGElement, press: () => void): HTMLButtonElement {
  const button = element('button', SITE_ICON_BUTTON);
  button.type = 'button';
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', press);
  return button;
}

function createField(caption: string): { field: HTMLElement; input: HTMLInputElement } {
  const field = element('label', FIELD_CLASS);
  const input = element('input', INPUT_CLASS);
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  field.append(element('span', 'dropdown-filter__label', caption), input);
  return { field, input };
}

function createTrigger(mobileClass: string | null): { trigger: HTMLButtonElement; label: HTMLElement } {
  const trigger = element('button', [mobileClass, SITE_TRIGGER, TRIGGER_CLASS].filter(Boolean).join(' '));
  trigger.type = 'button';
  trigger.setAttribute('aria-expanded', 'false');
  const label = element('span', undefined, RANGE_TEXT.trigger);
  const icon = priceTagIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  const chevron = chevronIcon();
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(icon, label, chevron);
  return { trigger, label };
}

function setValue(input: HTMLInputElement, value: string): void {
  if (input.value !== value) input.value = value;
}

function showRange({ minInput, maxInput }: RangeControl, range: PriceRange | null): void {
  setValue(minInput, formatBound(range?.min ?? null));
  setValue(maxInput, formatBound(range?.max ?? null));
}

function placePanel({ panel }: RangeControl): void {
  panel.style.removeProperty('left');
  const viewportWidth = panel.ownerDocument.documentElement.clientWidth;
  const box = panel.getBoundingClientRect();
  const overflow = box.right - (viewportWidth - VIEWPORT_MARGIN_PX);
  if (overflow > 0) panel.style.left = `${-Math.min(overflow, Math.max(0, box.left - VIEWPORT_MARGIN_PX))}px`;
}

function openPanel(control: RangeControl): void {
  control.panel.hidden = false;
  control.trigger.setAttribute('aria-expanded', 'true');
  placePanel(control);
  control.minInput.focus();
}

function closePanel(control: RangeControl, shouldFocusTrigger: boolean): void {
  if (control.panel.hidden) return;
  control.panel.hidden = true;
  control.trigger.setAttribute('aria-expanded', 'false');
  if (shouldFocusTrigger) control.trigger.focus();
}

function applyInputs(control: RangeControl, toolbar: Element, apply: ApplyRange): void {
  const range = createRange(parseBound(control.minInput.value), parseBound(control.maxInput.value));
  showRange(control, range);
  apply(toolbar, range);
}

function handlePanelKeydown(control: RangeControl, toolbar: Element, apply: ApplyRange, event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closePanel(control, true);
  } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
    event.preventDefault();
    applyInputs(control, toolbar, apply);
  }
}

function createPanel(): Pick<RangeControl, 'panel' | 'minInput' | 'maxInput'> & { actions: HTMLElement } {
  const panel = element('div', `${PANEL_CLASS} ${SITE_DROPDOWN}`);
  panel.hidden = true;
  const menu = element('div', 'dropdown-menu dropdown-menu--lg');
  const header = element('div', 'dropdown-filter__header');
  const actions = element('div', 'dropdown-filter__actions');
  header.append(element('div', 'dropdown-filter__caption', RANGE_TEXT.trigger), actions);
  const fields = element('div', FIELDS_CLASS);
  const min = createField(RANGE_TEXT.from);
  const max = createField(RANGE_TEXT.to);
  fields.append(min.field, max.field);
  menu.append(header, fields);
  const inner = element('div', 'v-popper__inner');
  inner.append(menu);
  const wrapper = element('div', 'v-popper__wrapper');
  wrapper.append(inner);
  panel.append(wrapper);
  return { panel, minInput: min.input, maxInput: max.input, actions };
}

function createControl(toolbar: Element, mobileClass: string | null, apply: ApplyRange): RangeControl {
  const wrapper = element('div', PRICE_FILTER_CLASS);
  const { trigger, label } = createTrigger(mobileClass);
  const { panel, minInput, maxInput, actions } = createPanel();
  const control: RangeControl = { wrapper, trigger, label, panel, minInput, maxInput };
  const reset = createIconButton(resetIcon(ICON_SIZE_PX), () => {
    showRange(control, null);
    apply(toolbar, null);
  });
  actions.append(
    reset,
    createIconButton(closeIcon(ICON_SIZE_PX), () => closePanel(control, true))
  );
  trigger.addEventListener('click', () => (panel.hidden ? openPanel(control) : closePanel(control, true)));
  panel.addEventListener('keydown', (event) => handlePanelKeydown(control, toolbar, apply, event));
  for (const input of [minInput, maxInput]) input.addEventListener('change', () => applyInputs(control, toolbar, apply));
  wrapper.append(trigger, panel);
  return control;
}

const isOwnNode = (node: Element): boolean => [...node.classList].some((name) => name.startsWith(OWN_PREFIX));

function insertControl(toolbar: Element, control: RangeControl): void {
  const firstOwn = [...toolbar.children].find(isOwnNode);
  if (firstOwn) toolbar.insertBefore(control.wrapper, firstOwn);
  else toolbar.append(control.wrapper);
}

function setText(target: HTMLElement, text: string): void {
  if (target.textContent !== text) target.textContent = text;
}

export function syncRangeControl(toolbar: Element, mobileClass: string | null, view: RangeView, apply: ApplyRange): void {
  const known = controls.get(toolbar);
  const control = known ?? createControl(toolbar, mobileClass, apply);
  if (!known) controls.set(toolbar, control);
  if (control.wrapper.parentElement !== toolbar) insertControl(toolbar, control);
  setText(control.label, view.label);
  control.trigger.classList.toggle(SITE_APPLIED, view.range !== null);
  if (control.panel.hidden) showRange(control, view.range);
}

export function removeRangeControl(toolbar: Element): void {
  controls.get(toolbar)?.wrapper.remove();
  controls.delete(toolbar);
}

export function closeRangePanels(pageDocument: Document, target: EventTarget | null): void {
  for (const wrapper of pageDocument.querySelectorAll(`.${PRICE_FILTER_CLASS}`)) {
    const toolbar = wrapper.parentElement;
    const control = toolbar ? controls.get(toolbar) : undefined;
    if (control && !(target instanceof Node && wrapper.contains(target))) closePanel(control, false);
  }
}
