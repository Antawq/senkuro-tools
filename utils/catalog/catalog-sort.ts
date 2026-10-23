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

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

export function sortOrderOf(variables: Row | undefined, kind: CatalogKind): SortOrder | null {
  const field = variables?.[ORDER_FIELD_VARIABLE];
  const key = typeof field === 'string' ? kind.sortKeys[field] : undefined;
  if (!key) return null;
  return { key, isDescending: variables?.[ORDER_DIRECTION_VARIABLE] !== ASCENDING };
}

export function sortKeysDocumentOf(kind: CatalogKind, slots: number): string {
  const slotNumbers = Array.from({ length: slots }, (_, index) => index);
  const declarations = slotNumbers.map((index) => `$s${index}: String!`).join(', ');
  const lookups = slotNumbers
    .map((index) => `a${index}: ${kind.lookupRoot}(slug: $s${index}) { id slug score views createdAt ${kind.lookupSelection} }`)
    .join(' ');
  return `query catalogSortKeys(${declarations}) { ${lookups} }`;
}

export function sortKeyVariablesOf(slugs: readonly string[], slots: number): Record<string, string> {
  const lastSlug = slugs.at(-1) ?? '';
  return Object.fromEntries(Array.from({ length: slots }, (_, index) => [`s${index}`, slugs[index] ?? lastSlug]));
}

export function readSortKeys(data: unknown): Map<string, Row> {
  const keysBySlug = new Map<string, Row>();
  if (!isRow(data)) return keysBySlug;
  for (const lookup of Object.values(data)) {
    if (isRow(lookup) && typeof lookup.slug === 'string') keysBySlug.set(lookup.slug, lookup);
  }
  return keysBySlug;
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

export function sortRows(rows: readonly Row[], keysBySlug: ReadonlyMap<string, Row>, order: SortOrder): Row[] {
  const direction = order.isDescending ? -1 : 1;
  const valueOf = (row: Row, key: string): unknown => keysBySlug.get(String(row.slug))?.[key];
  const compareKey = (first: Row, second: Row, key: string): number => {
    const firstValue = valueOf(first, key);
    const secondValue = valueOf(second, key);
    if (isMissing(firstValue) || isMissing(secondValue)) return Number(isMissing(firstValue)) - Number(isMissing(secondValue));
    return compareValues(firstValue, secondValue) * direction;
  };
  return [...rows].sort((first, second) => compareKey(first, second, order.key) || compareKey(first, second, TIE_BREAK_KEY));
}
