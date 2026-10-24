import { MODAL_CONTENT_SELECTOR } from '../shared/modal-selectors';
import {
  FILTERS,
  MENU,
  MENU_ITEM,
  MODE_ATTRIBUTE,
  OWN_ITEM,
  OWN_ITEM_ATTRIBUTE,
  PRICE_MODE,
  SAVED_LABEL_ATTRIBUTE,
  SORT_TEXT,
  TRIGGER,
  isOwnLabel,
  loadingLabelOf,
} from './sort-dom';

type LabelState = 'off' | 'loading' | 'price' | 'partial';

const SORT_LABEL = /^По /;

export const isPriceMode = (filters: Element): boolean => filters.getAttribute(MODE_ATTRIBUTE) === PRICE_MODE;

function createMenuItem(menu: Element): HTMLElement | null {
  const menuItems = menu.querySelectorAll<HTMLElement>(MENU_ITEM);
  const clone = menuItems.item(menuItems.length - 1)?.cloneNode(true) as HTMLElement | undefined;
  const input = clone?.querySelector('input');
  const labelElement = clone?.querySelector('span');
  if (!clone || !input || !labelElement) return null;
  clone.setAttribute(OWN_ITEM_ATTRIBUTE, '');
  input.value = PRICE_MODE;
  labelElement.textContent = SORT_TEXT.menuItem;
  return clone;
}

export function decorateMenu(pageDocument: Document, isPriceSelected: boolean): void {
  const menu = pageDocument.querySelector(MENU);
  if (!menu || pageDocument.querySelector(MODAL_CONTENT_SELECTOR)) return;
  if (!menu.querySelector(OWN_ITEM)) {
    const ownItem = createMenuItem(menu);
    if (!ownItem) return;
    menu.append(ownItem);
  }
  for (const input of menu.querySelectorAll<HTMLInputElement>(`${MENU_ITEM} input`)) {
    if (input.closest(OWN_ITEM)) input.checked = isPriceSelected;
    else if (isPriceSelected) input.checked = false;
  }
}

export const findSortTrigger = (pageDocument: Document): HTMLElement | undefined =>
  [...pageDocument.querySelectorAll<HTMLElement>(TRIGGER)].find((button) => SORT_LABEL.test(button.textContent?.trim() ?? ''));

function restoreLabel(filters: Element, labelElement: Element): void {
  const saved = filters.getAttribute(SAVED_LABEL_ATTRIBUTE);
  filters.removeAttribute(SAVED_LABEL_ATTRIBUTE);
  if (saved && isOwnLabel(labelElement.textContent)) labelElement.textContent = saved;
}

export function reflectLabel(pageDocument: Document, state: LabelState, percent: number | null = null): void {
  const filters = pageDocument.querySelector(FILTERS);
  const trigger = findSortTrigger(pageDocument);
  const labelElement = trigger?.querySelector('span');
  if (!filters || !trigger || !labelElement) return;
  if (state === 'off') {
    restoreLabel(filters, labelElement);
    trigger.removeAttribute('title');
    return;
  }
  const current = labelElement.textContent ?? '';
  if (current && !isOwnLabel(current)) filters.setAttribute(SAVED_LABEL_ATTRIBUTE, current);
  const wanted = { loading: loadingLabelOf(percent), price: SORT_TEXT.label, partial: SORT_TEXT.partialLabel }[state];
  if (current !== wanted) labelElement.textContent = wanted;
  if (state === 'partial') trigger.setAttribute('title', SORT_TEXT.partialHint);
  else trigger.removeAttribute('title');
}
