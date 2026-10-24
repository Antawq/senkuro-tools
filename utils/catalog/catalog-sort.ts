import type { FactsBySlug } from './catalog-facts';
import type { CatalogKind } from './catalog-results';

type Row = Record<string, unknown>;

export interface SortOrder {
  key: string;
  isDescending: boolean;
}

const ORDER_FIELD_VARIABLE = 'orderField';
const ORDER_DIRECTION_VARIABLE = 'orderDirection';
const ASCENDING = 'ASC';
const TIE_BREAK_KEY = 'createdAt';
const TIMESTAMP_FRACTION_DIGITS = 6;

export function sortOrderOf(variables: Row | undefined, kind: CatalogKind): SortOrder | null {
  const field = variables?.[ORDER_FIELD_VARIABLE];
  const key = typeof field === 'string' ? kind.sortKeys[field] : undefined;
  if (!key) return null;
  return { key, isDescending: variables?.[ORDER_DIRECTION_VARIABLE] !== ASCENDING };
}

const timestampOf = (value: string): string => {
  const [wholeSeconds = '', fraction = ''] = value.split('.');
  return `${wholeSeconds}.${fraction.padEnd(TIMESTAMP_FRACTION_DIGITS, '0')}`;
};

const compareValues = (first: unknown, second: unknown): number => {
  if (typeof first === 'number' && typeof second === 'number') return first - second;
  if (typeof first === 'string' && typeof second === 'string') return timestampOf(first).localeCompare(timestampOf(second));
  return 0;
};

const isMissing = (value: unknown): boolean => value === null || value === undefined;

export function sortRows(rows: readonly Row[], factsBySlug: FactsBySlug, order: SortOrder): Row[] {
  const direction = order.isDescending ? -1 : 1;
  const valueOf = (row: Row, key: string): unknown => factsBySlug.get(String(row.slug))?.[key];
  const compareKey = (first: Row, second: Row, key: string): number => {
    const firstValue = valueOf(first, key);
    const secondValue = valueOf(second, key);
    if (isMissing(firstValue) || isMissing(secondValue)) return Number(isMissing(firstValue)) - Number(isMissing(secondValue));
    return compareValues(firstValue, secondValue) * direction;
  };
  return [...rows].sort((first, second) => compareKey(first, second, order.key) || compareKey(first, second, TIE_BREAK_KEY));
}
