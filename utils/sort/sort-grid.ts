import { CARD_LINK, slugFromHref } from '../shared/cards';
import type { Database } from '../shared/database';
import { createPriceLookup, priceOrder } from './price-order';
import { CARD, STATE_ATTRIBUTE, writeAttribute, type GridState } from './sort-dom';

const slugOf = (card: HTMLElement | undefined): string | null => slugFromHref(card?.querySelector(CARD_LINK)?.getAttribute('href'));

export const cardsOf = (results: HTMLElement): HTMLElement[] =>
  [...results.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches(CARD));

export function orderCards(cards: HTMLElement[], database: Database, commission: boolean, isDescending: boolean): void {
  const order = priceOrder(cards.map(slugOf), createPriceLookup(database, commission), isDescending);
  cards.forEach((card, index) => {
    const orderValue = String(order[index]);
    if (card.style.order !== orderValue) card.style.order = orderValue;
  });
}

export const clearOrder = (cards: HTMLElement[]): void => cards.forEach((card) => card.style.removeProperty('order'));

export const markState = (grid: HTMLElement, state: GridState | null): void => writeAttribute(grid, STATE_ATTRIBUTE, state);
