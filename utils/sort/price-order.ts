import { PRICE_DECIMALS, effectivePrice } from '../shared/cards';
import type { Database } from '../shared/database';

interface Entry {
  index: number;
  price: number | null;
}

const createPriceComparator =
  (isDescending: boolean) =>
  (left: Entry, right: Entry): number => {
    if (left.price === null || right.price === null) return Number(left.price === null) - Number(right.price === null);
    return isDescending ? right.price - left.price : left.price - right.price;
  };

export const createPriceLookup =
  (database: Database, commission: boolean) =>
  (slug: string): number | null => {
    const entry = database[slug];
    return entry && Number.isFinite(entry.price) ? Number(effectivePrice(entry.price, commission).toFixed(PRICE_DECIMALS)) : null;
  };

export function priceOrder(slugs: (string | null)[], priceBySlug: (slug: string) => number | null, isDescending: boolean): number[] {
  const entries = slugs.map((slug, index): Entry => ({ index, price: slug === null ? null : priceBySlug(slug) }));
  const order: number[] = new Array<number>(slugs.length);
  [...entries].sort(createPriceComparator(isDescending)).forEach((entry, position) => {
    order[entry.index] = position;
  });
  return order;
}

export function sortedIndices(slugs: (string | null)[], priceBySlug: (slug: string) => number | null, isDescending: boolean): number[] {
  const indices: number[] = new Array<number>(slugs.length);
  priceOrder(slugs, priceBySlug, isDescending).forEach((position, index) => {
    indices[position] = index;
  });
  return indices;
}
