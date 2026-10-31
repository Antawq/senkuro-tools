export interface PriceRange {
  min: number | null;
  max: number | null;
}

export const RANGE_ATTRIBUTE = 'data-senkutools-price-range';

const BOUND_SEPARATOR = ':';
const SPACES = /\s+/g;
const DECIMAL_COMMA = /,/g;

export function parseBound(text: string): number | null {
  const normalized = text.replace(SPACES, '').replace(DECIMAL_COMMA, '.');
  if (normalized === '') return null;
  const bound = Number(normalized);
  return Number.isFinite(bound) ? bound : null;
}

export function createRange(min: number | null, max: number | null): PriceRange | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) return { min: max, max: min };
  return { min, max };
}

export const isInRange = (price: number | null, { min, max }: PriceRange): boolean =>
  price !== null && (min === null || price >= min) && (max === null || price <= max);

export const formatBound = (bound: number | null): string => (bound === null ? '' : String(bound));

export const rangeKeyOf = (range: PriceRange | null): string | null => (range ? `${formatBound(range.min)}${BOUND_SEPARATOR}${formatBound(range.max)}` : null);

export function readRange(toolbar: Element): PriceRange | null {
  const [min, max, ...rest] = (toolbar.getAttribute(RANGE_ATTRIBUTE) ?? '').split(BOUND_SEPARATOR);
  if (min === undefined || max === undefined || rest.length > 0) return null;
  return createRange(parseBound(min), parseBound(max));
}

export function writeRange(toolbar: Element, range: PriceRange | null): void {
  const key = rangeKeyOf(range);
  if (key === null) toolbar.removeAttribute(RANGE_ATTRIBUTE);
  else if (toolbar.getAttribute(RANGE_ATTRIBUTE) !== key) toolbar.setAttribute(RANGE_ATTRIBUTE, key);
}
