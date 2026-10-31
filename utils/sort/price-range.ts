import { writeAttribute } from '../shared/dom';

export interface PriceRange {
  min: number | null;
  max: number | null;
}

const RANGE_ATTRIBUTE = 'data-senkutools-price-range';

const BOUND_SEPARATOR = ':';
const SPACES = /\s+/g;
const DECIMAL_COMMA = /,/g;

export function parseBound(text: string): number | null {
  const normalized = text.replace(SPACES, '').replace(DECIMAL_COMMA, '.');
  if (normalized === '') return null;
  const bound = Number(normalized);
  return Number.isFinite(bound) ? bound : null;
}

export const createRange = (min: number | null, max: number | null): PriceRange | null => (min === null && max === null ? null : { min, max });

export const isReversed = ({ min, max }: PriceRange): boolean => min !== null && max !== null && min > max;

export const isInRange = (price: number | null, { min, max }: PriceRange): boolean =>
  price !== null && (min === null || price >= min) && (max === null || price <= max);

export const formatBound = (bound: number | null): string => (bound === null ? '' : String(bound));

export const rangeKeyOf = (range: PriceRange | null): string | null => (range ? `${formatBound(range.min)}${BOUND_SEPARATOR}${formatBound(range.max)}` : null);

export function readRange(toolbar: Element): PriceRange | null {
  const key = toolbar.getAttribute(RANGE_ATTRIBUTE);
  if (key === null) return null;
  const [min, max, ...rest] = key.split(BOUND_SEPARATOR);
  if (min === undefined || max === undefined || rest.length > 0) return null;
  const range = createRange(parseBound(min), parseBound(max));
  return range && !isReversed(range) ? range : null;
}

export const writeRange = (toolbar: Element, range: PriceRange | null): void => writeAttribute(toolbar, RANGE_ATTRIBUTE, rangeKeyOf(range));
