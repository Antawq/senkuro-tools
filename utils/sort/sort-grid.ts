import { CARD_LINK, PRICE_DECIMALS, effectivePrice, slugFromHref } from '../shared/cards';
import type { Database } from '../shared/database';
import { priceOrder } from './price-order';
import { CARD, GRID, STATE_ATTRIBUTE, type GridState } from './sort-dom';

export interface GridView {
  grid: HTMLElement;
  cards: HTMLElement[];
  pending: boolean;
  gridKey: string;
}

const slugOf = (card: HTMLElement | undefined): string | null => slugFromHref(card?.querySelector(CARD_LINK)?.getAttribute('href'));

const keyOf = (cards: HTMLElement[]): string => `${cards.length}|${slugOf(cards[0])}|${slugOf(cards.at(-1))}`;

export function inspectGrid(pageDocument: Document): GridView | null {
  const grid = pageDocument.querySelector<HTMLElement>(GRID);
  if (!grid) return null;
  const cards = [...grid.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches(CARD));
  return { grid, cards, pending: grid.children.length > cards.length, gridKey: keyOf(cards) };
}

const priceFor =
  (database: Database, commission: boolean) =>
  (slug: string): number | null => {
    const entry = database[slug];
    return entry && Number.isFinite(entry.price) ? Number(effectivePrice(entry.price, commission).toFixed(PRICE_DECIMALS)) : null;
  };

export function orderCards(cards: HTMLElement[], database: Database, commission: boolean, descending: boolean): void {
  const order = priceOrder(cards.map(slugOf), priceFor(database, commission), descending);
  cards.forEach((card, index) => {
    const place = String(order[index]);
    if (card.style.order !== place) card.style.order = place;
  });
}

export const clearOrder = (cards: HTMLElement[]): void => cards.forEach((card) => card.style.removeProperty('order'));

export function markState(grid: HTMLElement, state: GridState | null): void {
  if (state === null) grid.removeAttribute(STATE_ATTRIBUTE);
  else if (grid.getAttribute(STATE_ATTRIBUTE) !== state) grid.setAttribute(STATE_ATTRIBUTE, state);
}
