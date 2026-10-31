import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PriceRange } from '../utils/sort/price-range';
import { closeRangePanels, rangeLabelOf, removeRangeControl, syncRangeControl, type RangeView } from '../utils/sort/range-control';

const toolbarHtml = (withRefresh = false) =>
  `<div class="modal-trade__header-form"><div class="v-popper"><button id="sort">По дате получения</button></div><button id="direction">Сначала</button><div class="v-popper"><button id="filter">Фильтр</button></div>${
    withRefresh ? '<button class="button senkutools-modal-refresh"></button>' : ''
  }</div>`;

const toolbar = () => document.querySelector('.modal-trade__header-form') as HTMLElement;
const control = () => document.querySelector<HTMLElement>('.senkutools-price-filter');
const trigger = () => document.querySelector<HTMLButtonElement>('.senkutools-price-filter__trigger');
const panel = () => document.querySelector<HTMLElement>('.senkutools-price-filter__panel');
const inputs = () => [...document.querySelectorAll<HTMLInputElement>('.senkutools-price-filter__input')];
const actionButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.senkutools-price-filter__panel .dropdown-filter__actions button')];
const offView: RangeView = { label: 'Цена', range: null };

const draw = (view: RangeView = offView, mobileClass: string | null = 'modal-trade__header-form__mob') => {
  const applied: (PriceRange | null)[] = [];
  const apply = vi.fn((_toolbar: Element, range: PriceRange | null) => void applied.push(range));
  syncRangeControl(toolbar(), mobileClass, view, apply);
  return { applied, apply, redraw: (next: RangeView) => syncRangeControl(toolbar(), mobileClass, next, apply) };
};

const type = (input: HTMLInputElement | undefined, text: string) => {
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const press = (target: Element | undefined | null, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target?.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  document.body.innerHTML = toolbarHtml();
});

describe('the price range control', () => {
  it('stands after the controls of the site, made of the site button classes and the class the place hides labels with on phones', () => {
    draw();
    expect(toolbar().lastElementChild).toBe(control());
    expect(trigger()?.className).toBe('modal-trade__header-form__mob button button--secondary button--auto button-size--md senkutools-price-filter__trigger');
    expect(trigger()?.type).toBe('button');
    expect(trigger()?.textContent).toBe('Цена');
    expect(trigger()?.querySelectorAll('svg')).toHaveLength(2);
    expect(trigger()?.lastElementChild?.getAttribute('class')).toBe('senkutools-price-filter__chevron');
    document.body.innerHTML = toolbarHtml();
    draw(offView, null);
    expect(trigger()?.className).toBe('button button--secondary button--auto button-size--md senkutools-price-filter__trigger');
  });

  it('stands before the refresh button of the window, so neither moves the other', () => {
    document.body.innerHTML = toolbarHtml(true);
    draw();
    expect(control()?.nextElementSibling?.classList.contains('senkutools-modal-refresh')).toBe(true);
  });

  it('is drawn once per toolbar, put back when the site took it away, and taken away on request', () => {
    const { redraw } = draw();
    redraw(offView);
    expect(document.querySelectorAll('.senkutools-price-filter')).toHaveLength(1);
    control()?.remove();
    redraw(offView);
    expect(document.querySelectorAll('.senkutools-price-filter')).toHaveLength(1);
    removeRangeControl(toolbar());
    expect(control()).toBeNull();
  });

  it('opens on a click with two fields, от and до, that ask for a decimal keyboard, the first one focused, and closes on a second click', () => {
    draw();
    expect(panel()?.hidden).toBe(true);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    trigger()?.click();
    expect(panel()?.hidden).toBe(false);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect([...document.querySelectorAll('.senkutools-price-filter__field')].map((field) => field.textContent)).toEqual(['от', 'до']);
    expect(inputs().map((input) => [input.type, input.inputMode])).toEqual([
      ['text', 'decimal'],
      ['text', 'decimal'],
    ]);
    expect(document.activeElement).toBe(inputs()[0]);
    trigger()?.click();
    expect(panel()?.hidden).toBe(true);
  });

  it('is built from the dropdown classes of the site: a caption and the reset and close buttons in its header', () => {
    draw();
    expect(panel()?.classList.contains('v-popper--theme-dropdown')).toBe(true);
    expect(panel()?.querySelector('.v-popper__wrapper > .v-popper__inner > .dropdown-menu.dropdown-menu--lg')).not.toBeNull();
    expect(panel()?.querySelector('.dropdown-filter__header .dropdown-filter__caption')?.textContent).toBe('Цена');
    expect(actionButtons().map((button) => button.className)).toEqual([
      'button button--secondary button--icon button-size--md',
      'button button--secondary button--icon button-size--md',
    ]);
  });

  it('closes on its close button and on Escape, giving the focus back to the trigger, and keeps Escape from the window', () => {
    draw();
    trigger()?.click();
    actionButtons()[1]?.click();
    expect(panel()?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
    trigger()?.click();
    const heard = vi.fn();
    document.body.addEventListener('keydown', heard);
    press(inputs()[0], 'Escape');
    expect(panel()?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
    expect(heard).not.toHaveBeenCalled();
  });

  it('closes on a pointer down outside it, and stays open for one inside it', () => {
    draw();
    trigger()?.click();
    closeRangePanels(document, inputs()[1] ?? null);
    expect(panel()?.hidden).toBe(false);
    closeRangePanels(document, document.querySelector('#sort'));
    expect(panel()?.hidden).toBe(true);
    expect(document.activeElement).not.toBe(trigger());
  });

  it('applies the range on a change of a field and on Enter, and shows the range it applied', () => {
    const { applied } = draw();
    trigger()?.click();
    type(inputs()[0], '1,5');
    expect(applied.at(-1)).toEqual({ min: 1.5, max: null });
    expect(inputs()[0]?.value).toBe('1.5');
    if (inputs()[1]) inputs()[1]!.value = '20';
    const enter = press(inputs()[1], 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(applied.at(-1)).toEqual({ min: 1.5, max: 20 });
  });

  it('applies nothing for bounds the wrong way round: marks the field just changed, says why, and applies once the bounds agree again', () => {
    const { applied } = draw({ label: 'Цена', range: { min: 1, max: 2 } });
    trigger()?.click();
    type(inputs()[0], '99');
    expect(applied).toEqual([]);
    expect(inputs().map((input) => input.value)).toEqual(['99', '2']);
    expect(inputs()[0]?.getAttribute('aria-invalid')).toBe('true');
    expect(inputs()[1]?.hasAttribute('aria-invalid')).toBe(false);
    const error = document.querySelector<HTMLElement>('.senkutools-price-filter__error');
    expect(error?.textContent).toBe('«От» больше, чем «до»');
    expect(error?.className).toContain('dropdown-filter__info dropdown-filter__info--error');
    expect(error?.hidden).toBe(false);
    type(inputs()[1], '');
    expect(applied).toEqual([{ min: 99, max: null }]);
    expect(inputs()[0]?.hasAttribute('aria-invalid')).toBe(false);
    expect(document.querySelector<HTMLElement>('.senkutools-price-filter__error')?.hidden).toBe(true);
  });

  it('marks the upper bound when it is the one typed below the lower bound', () => {
    const { applied } = draw({ label: 'Цена', range: { min: 10, max: null } });
    trigger()?.click();
    press(inputs()[1], 'Enter');
    if (inputs()[1]) inputs()[1]!.value = '5';
    press(inputs()[1], 'Enter');
    expect(applied).toEqual([{ min: 10, max: null }]);
    expect(inputs()[1]?.getAttribute('aria-invalid')).toBe('true');
    expect(inputs()[0]?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('clears a field that holds no number before it applies', () => {
    const { applied } = draw();
    trigger()?.click();
    if (inputs()[1]) inputs()[1]!.value = '50';
    type(inputs()[0], 'abc');
    expect(applied.at(-1)).toEqual({ min: null, max: 50 });
    expect(inputs()[0]?.value).toBe('');
    type(inputs()[1], '');
    expect(applied.at(-1)).toBeNull();
  });

  it('clears both fields and the range with its reset button', () => {
    const { applied } = draw({ label: 'Цена', range: { min: 1, max: 2 } });
    trigger()?.click();
    actionButtons()[0]?.click();
    expect(applied).toEqual([null]);
    expect(inputs().map((input) => input.value)).toEqual(['', '']);
  });

  it('marks the trigger with the dot of the site while a range is on and shows the label it is given', () => {
    const { redraw } = draw({ label: rangeLabelOf(40), range: { min: 1, max: null } });
    expect(trigger()?.classList.contains('button--chip')).toBe(true);
    expect(trigger()?.textContent).toBe('Цена 40%');
    redraw({ label: rangeLabelOf(null), range: null });
    expect(trigger()?.classList.contains('button--chip')).toBe(false);
    expect(trigger()?.textContent).toBe('Цена');
  });

  it('shows the applied range in its fields while it is closed, and leaves what is being typed alone while it is open', () => {
    const { redraw } = draw({ label: 'Цена', range: { min: 3, max: 7.5 } });
    expect(inputs().map((input) => input.value)).toEqual(['3', '7.5']);
    trigger()?.click();
    if (inputs()[0]) inputs()[0]!.value = '9';
    redraw({ label: 'Цена', range: null });
    expect(inputs()[0]?.value).toBe('9');
    trigger()?.click();
    redraw({ label: 'Цена', range: null });
    expect(inputs().map((input) => input.value)).toEqual(['', '']);
  });
});
