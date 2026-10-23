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

export function priceOrder(slugs: (string | null)[], priceBySlug: (slug: string) => number | null, isDescending: boolean): number[] {
  const entries = slugs.map((slug, index): Entry => ({ index, price: slug === null ? null : priceBySlug(slug) }));
  const order: number[] = new Array<number>(slugs.length);
  [...entries].sort(createPriceComparator(isDescending)).forEach((entry, position) => {
    order[entry.index] = position;
  });
  return order;
}
