import { describe, expect, it } from 'vitest';

import { priceOrder } from '../utils/sort/price-order';

const prices: Record<string, number> = { cheap: 1.5, mid: 20, dear: 300, twin: 20, free: 0 };

const priceOf = (slug: string): number | null => prices[slug] ?? null;

const shown = (slugs: (string | null)[], descending: boolean): (string | null)[] => {
  const order = priceOrder(slugs, priceOf, descending);
  const result: (string | null)[] = [];
  order.forEach((position, index) => {
    result[position] = slugs[index] ?? null;
  });
  return result;
};

describe('priceOrder', () => {
  it('puts the most expensive first when descending and the cheapest first when ascending', () => {
    expect(shown(['mid', 'dear', 'cheap'], true)).toEqual(['dear', 'mid', 'cheap']);
    expect(shown(['mid', 'dear', 'cheap'], false)).toEqual(['cheap', 'mid', 'dear']);
  });

  it('keeps the site order among equal prices, whichever way it runs', () => {
    expect(shown(['twin', 'dear', 'mid'], true)).toEqual(['dear', 'twin', 'mid']);
    expect(shown(['mid', 'twin', 'dear'], true)).toEqual(['dear', 'mid', 'twin']);
    expect(shown(['twin', 'cheap', 'mid'], false)).toEqual(['cheap', 'twin', 'mid']);
    expect(shown(['mid', 'cheap', 'twin'], false)).toEqual(['cheap', 'mid', 'twin']);
  });

  it('keeps cards without a price at the end in the site order, whichever way it runs', () => {
    const slugs = ['nope', 'cheap', null, 'dear', 'also-nope'];
    expect(shown(slugs, true)).toEqual(['dear', 'cheap', 'nope', null, 'also-nope']);
    expect(shown(slugs, false)).toEqual(['cheap', 'dear', 'nope', null, 'also-nope']);
  });

  it('counts a price of zero as a price, not as a missing one', () => {
    expect(shown(['nope', 'free', 'cheap'], true)).toEqual(['cheap', 'free', 'nope']);
    expect(shown(['nope', 'free', 'cheap'], false)).toEqual(['free', 'cheap', 'nope']);
  });

  it('gives every card its own place, from zero up', () => {
    const order = priceOrder(['mid', 'nope', 'dear', 'mid', null], priceOf, true);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(priceOrder([], priceOf, true)).toEqual([]);
  });

  it('looks the price of each card up once, not once per comparison', () => {
    const seen: string[] = [];
    priceOrder(['mid', 'dear', 'cheap', 'mid', 'twin'], (slug) => (seen.push(slug), priceOf(slug)), true);
    expect(seen).toHaveLength(5);
  });
});
