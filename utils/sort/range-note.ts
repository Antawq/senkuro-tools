import { element, writeAttribute } from '../shared/dom';
import { PRICE_EMPTY_CLASS } from '../shared/price-filter-nodes';

const EMPTY_RANGE_TEXT = 'Нет карт в этом диапазоне цен';

const EMPTY_ATTRIBUTE = 'data-senkutools-price-empty';

export function syncRangeNote(listArea: Element | null, isShown: boolean): void {
  if (!listArea) return;
  writeAttribute(listArea, EMPTY_ATTRIBUTE, isShown ? '' : null);
  const note = listArea.querySelector(`:scope > .${PRICE_EMPTY_CLASS}`);
  if (!isShown) note?.remove();
  else if (!note) listArea.append(element('div', PRICE_EMPTY_CLASS, EMPTY_RANGE_TEXT));
}
