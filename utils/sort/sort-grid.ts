import { CARD_LINK, slugFromHref } from '../shared/cards';
import type { Database } from '../shared/database';
import { createPriceLookup, priceOrder } from './price-order';
import { CARD, GRID, STATE_ATTRIBUTE, type GridState } from './sort-dom';

export interface GridView {
  grid: HTMLElement;
  cards: HTMLElement[];
  hasMoreCards: boolean;
  gridKey: string;
}

const slugOf = (card: HTMLElement | undefined): string | null => slugFromHref(card?.querySelector(CARD_LINK)?.getAttribute('href'));

const keyOf = (cards: HTMLElement[]): string => `${cards.length}|${slugOf(cards[0])}|${slugOf(cards.at(-1))}`;

export function inspectGrid(pageDocument: Document): GridView | null {
  const grid = pageDocument.querySelector<HTMLElement>(GRID);
  if (!grid) return null;
  const cards = [...grid.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches(CARD));
  return { grid, cards, hasMoreCards: grid.children.length > cards.length, gridKey: keyOf(cards) };
}

export function orderCards(cards: HTMLElement[], database: Database, commission: boolean, isDescending: boolean): void {
  const order = priceOrder(cards.map(slugOf), createPriceLookup(database, commission), isDescending);
  cards.forEach((card, index) => {
    const orderValue = String(order[index]);
    if (card.style.order !== orderValue) card.style.order = orderValue;
  });
}

export const clearOrder = (cards: HTMLElement[]): void => cards.forEach((card) => card.style.removeProperty('order'));

export function markState(grid: HTMLElement, state: GridState | null): void {
  if (state === null) grid.removeAttribute(STATE_ATTRIBUTE);
  else if (grid.getAttribute(STATE_ATTRIBUTE) !== state) grid.setAttribute(STATE_ATTRIBUTE, state);
}
