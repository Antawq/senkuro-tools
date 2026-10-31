import { PRICE_DECIMALS, effectivePrice } from '../shared/cards';
import type { Database } from '../shared/database';
import type { ViewSort } from '../shared/price-signal';
import { isInRange, type PriceRange } from './price-range';

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

function sortedIndices(slugs: (string | null)[], priceBySlug: (slug: string) => number | null, isDescending: boolean): number[] {
  const indices: number[] = new Array<number>(slugs.length);
  priceOrder(slugs, priceBySlug, isDescending).forEach((position, index) => {
    indices[position] = index;
  });
  return indices;
}

export interface ListOrders {
  descending: number[];
  ascending: number[];
}

export function listOrders(slugs: (string | null)[], priceBySlug: (slug: string) => number | null, sort: ViewSort, range: PriceRange | null): ListOrders {
  const isShown = (index: number): boolean => {
    const slug = slugs[index] ?? null;
    return range === null || isInRange(slug === null ? null : priceBySlug(slug), range);
  };
  if (sort === 'site') {
    const shown = slugs.map((_slug, index) => index).filter(isShown);
    return { descending: shown, ascending: [...shown] };
  }
  return {
    descending: sortedIndices(slugs, priceBySlug, true).filter(isShown),
    ascending: sortedIndices(slugs, priceBySlug, false).filter(isShown),
  };
}
