import {
  FILTERS,
  ITEM,
  MENU,
  MODE_ATTRIBUTE,
  OPEN_MODAL,
  OWN_ITEM,
  OWN_ITEM_ATTRIBUTE,
  PRICE_MODE,
  SAVED_LABEL_ATTRIBUTE,
  TEXT,
  TRIGGER,
  isOwnLabel,
} from './sort-dom';

type LabelState = 'off' | 'price' | 'partial';

const SORT_LABEL = /^По /;

export const isPriceMode = (filters: Element): boolean => filters.getAttribute(MODE_ATTRIBUTE) === PRICE_MODE;

function buildItem(menu: Element): HTMLElement | null {
  const items = menu.querySelectorAll<HTMLElement>(ITEM);
  const clone = items.item(items.length - 1)?.cloneNode(true) as HTMLElement | undefined;
  const input = clone?.querySelector('input');
  const text = clone?.querySelector('span');
  if (!clone || !input || !text) return null;
  clone.setAttribute(OWN_ITEM_ATTRIBUTE, '');
  input.value = PRICE_MODE;
  text.textContent = TEXT.item;
  return clone;
}

export function decorateMenu(doc: Document, on: boolean): void {
  const menu = doc.querySelector(MENU);
  if (!menu || doc.querySelector(OPEN_MODAL)) return;
  if (!menu.querySelector(OWN_ITEM)) {
    const built = buildItem(menu);
    if (!built) return;
    menu.append(built);
  }
  for (const input of menu.querySelectorAll<HTMLInputElement>(`${ITEM} input`)) {
    if (input.closest(OWN_ITEM)) input.checked = on;
    else if (on) input.checked = false;
  }
}

export const sortTrigger = (doc: Document): HTMLElement | undefined =>
  [...doc.querySelectorAll<HTMLElement>(TRIGGER)].find((button) => SORT_LABEL.test(button.textContent?.trim() ?? ''));

function restoreLabel(filters: Element, text: Element): void {
  const saved = filters.getAttribute(SAVED_LABEL_ATTRIBUTE);
  filters.removeAttribute(SAVED_LABEL_ATTRIBUTE);
  if (saved && isOwnLabel(text.textContent)) text.textContent = saved;
}

export function reflectLabel(doc: Document, state: LabelState): void {
  const filters = doc.querySelector(FILTERS);
  const trigger = sortTrigger(doc);
  const text = trigger?.querySelector('span');
  if (!filters || !trigger || !text) return;
  if (state === 'off') {
    restoreLabel(filters, text);
    trigger.removeAttribute('title');
    return;
  }
  const current = text.textContent ?? '';
  if (current && !isOwnLabel(current)) filters.setAttribute(SAVED_LABEL_ATTRIBUTE, current);
  const wanted = state === 'price' ? TEXT.label : TEXT.partialLabel;
  if (current !== wanted) text.textContent = wanted;
  if (state === 'partial') trigger.setAttribute('title', TEXT.partialHint);
  else trigger.removeAttribute('title');
}
