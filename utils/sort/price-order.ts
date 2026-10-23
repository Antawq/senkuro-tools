interface Entry {
  index: number;
  price: number | null;
}

const byPrice =
  (descending: boolean) =>
  (left: Entry, right: Entry): number => {
    if (left.price === null || right.price === null) return Number(left.price === null) - Number(right.price === null);
    return descending ? right.price - left.price : left.price - right.price;
  };

export function priceOrder(slugs: (string | null)[], priceOf: (slug: string) => number | null, descending: boolean): number[] {
  const entries = slugs.map((slug, index): Entry => ({ index, price: slug === null ? null : priceOf(slug) }));
  const order: number[] = new Array<number>(slugs.length);
  [...entries].sort(byPrice(descending)).forEach((entry, position) => {
    order[entry.index] = position;
  });
  return order;
}
