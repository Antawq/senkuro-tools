import { POSTER_CARDS_PER_PAGE } from './poster-layout';

export function splitIntoPages<T>(cards: readonly T[]): T[][] {
  if (cards.length === 0) return [];
  const pageCount = Math.ceil(cards.length / POSTER_CARDS_PER_PAGE);
  const baseSize = Math.floor(cards.length / pageCount);
  const largerPageCount = cards.length % pageCount;
  const startOf = (index: number): number => index * baseSize + Math.min(index, largerPageCount);
  return Array.from({ length: pageCount }, (_, index) => cards.slice(startOf(index), startOf(index + 1)));
}
