import type { CatalogKind } from './catalog-results';

type Row = Record<string, unknown>;

export type FactsBySlug = ReadonlyMap<string, Row>;

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

export function factsDocumentOf(kind: CatalogKind, slots: number): string {
  const slotNumbers = Array.from({ length: slots }, (_, index) => index);
  const declarations = slotNumbers.map((index) => `$s${index}: String!`).join(', ');
  const lookups = slotNumbers
    .map((index) => `a${index}: ${kind.lookupRoot}(slug: $s${index}) { id slug score views createdAt ${kind.lookupSelection} }`)
    .join(' ');
  return `query catalogRowFacts(${declarations}) { ${lookups} }`;
}

export function factVariablesOf(slugs: readonly string[], slots: number): Record<string, string> {
  const lastSlug = slugs.at(-1) ?? '';
  return Object.fromEntries(Array.from({ length: slots }, (_, index) => [`s${index}`, slugs[index] ?? lastSlug]));
}

export function readFacts(data: unknown): Map<string, Row> {
  const factsBySlug = new Map<string, Row>();
  if (!isRow(data)) return factsBySlug;
  for (const lookup of Object.values(data)) {
    if (isRow(lookup) && typeof lookup.slug === 'string') factsBySlug.set(lookup.slug, lookup);
  }
  return factsBySlug;
}
