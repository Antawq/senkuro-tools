import {
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

export const isPriceMode = (toolbar: Element): boolean => toolbar.getAttribute(MODE_ATTRIBUTE) === PRICE_MODE;

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
  if (!menu) return;
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

export const findSortTrigger = (toolbar: Element): HTMLElement | undefined =>
  [...toolbar.querySelectorAll<HTMLElement>(TRIGGER)].find((button) => SORT_LABEL.test(button.textContent?.trim() ?? ''));

function restoreLabel(toolbar: Element, labelElement: Element): void {
  const saved = toolbar.getAttribute(SAVED_LABEL_ATTRIBUTE);
  toolbar.removeAttribute(SAVED_LABEL_ATTRIBUTE);
  if (saved && isOwnLabel(labelElement.textContent)) labelElement.textContent = saved;
}

function findLabelParts(toolbar: Element): { trigger: HTMLElement; labelElement: HTMLElement } | null {
  const trigger = findSortTrigger(toolbar);
  const labelElement = trigger?.querySelector('span');
  return trigger && labelElement ? { trigger, labelElement } : null;
}

function showOwnLabel(toolbar: Element, labelElement: Element, wanted: string): void {
  const current = labelElement.textContent ?? '';
  if (current && !isOwnLabel(current)) toolbar.setAttribute(SAVED_LABEL_ATTRIBUTE, current);
  if (current !== wanted) labelElement.textContent = wanted;
}

export function reflectLabel(toolbar: Element, state: LabelState, percent: number | null = null): void {
  const parts = findLabelParts(toolbar);
  if (!parts) return;
  const { trigger, labelElement } = parts;
  if (state === 'off') {
    restoreLabel(toolbar, labelElement);
    trigger.removeAttribute('title');
    return;
  }
  showOwnLabel(toolbar, labelElement, { loading: loadingLabelOf(percent), price: SORT_TEXT.label, partial: SORT_TEXT.partialLabel }[state]);
  if (state === 'partial') trigger.setAttribute('title', SORT_TEXT.partialHint);
  else trigger.removeAttribute('title');
}
