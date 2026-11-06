import { describe, expect, it } from 'vitest';

import { POSTER_CARDS_PER_PAGE } from '../utils/poster/poster-layout';
import { splitIntoPages } from '../utils/poster/poster-pages';

const numbers = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

const sizesOf = (count: number): number[] => splitIntoPages(numbers(count)).map((page) => page.length);

describe('splitIntoPages', () => {
  it('returns no page for no card', () => {
    expect(splitIntoPages([])).toEqual([]);
  });

  it('keeps up to one page of cards on a single page', () => {
    expect(sizesOf(1)).toEqual([1]);
    expect(sizesOf(POSTER_CARDS_PER_PAGE)).toEqual([POSTER_CARDS_PER_PAGE]);
  });

  it('balances the pages instead of leaving a lone card on the last one', () => {
    expect(sizesOf(POSTER_CARDS_PER_PAGE + 1)).toEqual([16, 15]);
    expect(sizesOf(2 * POSTER_CARDS_PER_PAGE)).toEqual([30, 30]);
    expect(sizesOf(2 * POSTER_CARDS_PER_PAGE + 1)).toEqual([21, 20, 20]);
    expect(sizesOf(100)).toEqual([25, 25, 25, 25]);
  });

  it('keeps the order and every card for any count', () => {
    for (let count = 1; count <= 200; count++) {
      const pages = splitIntoPages(numbers(count));
      expect(pages.flat()).toEqual(numbers(count));
      expect(Math.max(...pages.map((page) => page.length))).toBeLessThanOrEqual(POSTER_CARDS_PER_PAGE);
      expect(Math.max(...pages.map((page) => page.length)) - Math.min(...pages.map((page) => page.length))).toBeLessThanOrEqual(1);
      expect(pages).toHaveLength(Math.ceil(count / POSTER_CARDS_PER_PAGE));
    }
  });

  it('does not change the list it is given', () => {
    const cards = numbers(45);
    splitIntoPages(cards);
    expect(cards).toEqual(numbers(45));
  });
});
