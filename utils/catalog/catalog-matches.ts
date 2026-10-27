import type { QueryClient } from '../shared/urql-client';
import { factVariablesOf, factsDocumentOf, readFacts, type FactsBySlug } from './catalog-facts';
import { rowPasses, type CatalogFilters } from './catalog-filters';
import { CATALOG_ROW_LIMIT, SEARCH_PAGE_ROWS, type CatalogKind } from './catalog-results';
import { sortRows, type SortOrder } from './catalog-sort';
import { isCatalogRow, type CatalogRow } from './catalog-row';

type QueryOptions = Record<string, unknown> | undefined;

const CACHE_FIRST = { requestPolicy: 'cache-first' };

const CARD_FACTS = ['containExplicitThemes', 'formats'];

const factsDocuments = new Map<string, string>();

export interface MatchQuery {
  text: string;
  order: SortOrder | null;
  filters: CatalogFilters;
}

const factsDocumentFor = (kind: CatalogKind): string => {
  let document = factsDocuments.get(kind.operation);
  if (document === undefined) {
    document = factsDocumentOf(kind, SEARCH_PAGE_ROWS);
    factsDocuments.set(kind.operation, document);
  }
  return document;
};

async function ask(client: QueryClient, document: string, variables: Record<string, unknown>, options: QueryOptions): Promise<CatalogRow> {
  const answer = await client.query(document, variables, { ...options, ...CACHE_FIRST }).toPromise();
  return isCatalogRow(answer) ? answer : {};
}

const searchRowsOf = (edges: unknown[]): CatalogRow[] =>
  edges.flatMap((edge) => (isCatalogRow(edge) && isCatalogRow(edge.node) && typeof edge.node.slug === 'string' ? [edge.node] : []));

function searchPageOf(answer: CatalogRow): { search: CatalogRow; edges: unknown[] } | null {
  const search = isCatalogRow(answer.data) ? answer.data.search : null;
  return isCatalogRow(search) && Array.isArray(search.edges) ? { search, edges: search.edges } : null;
}

function nextCursorOf(search: CatalogRow, edges: unknown[]): string | null {
  const pageInfo = isCatalogRow(search.pageInfo) ? search.pageInfo : {};
  return pageInfo.hasNextPage === true && typeof pageInfo.endCursor === 'string' && edges.length > 0 ? pageInfo.endCursor : null;
}

async function* searchPages(
  client: QueryClient,
  kind: CatalogKind,
  text: string,
  options: QueryOptions,
  signal: AbortSignal | undefined
): AsyncGenerator<CatalogRow[]> {
  let after: string | null = null;
  let totalCount = CATALOG_ROW_LIMIT;
  let loadedCount = 0;
  while (!signal?.aborted && loadedCount < Math.min(totalCount, CATALOG_ROW_LIMIT)) {
    const searchPage = searchPageOf(await ask(client, kind.searchDocument, { query: text, type: kind.searchType, first: SEARCH_PAGE_ROWS, after }, options));
    if (!searchPage) return;
    const rows = searchRowsOf(searchPage.edges);
    loadedCount += rows.length;
    if (rows.length > 0) yield rows;
    if (typeof searchPage.search.totalCount === 'number') totalCount = searchPage.search.totalCount;
    after = nextCursorOf(searchPage.search, searchPage.edges);
    if (after === null) return;
  }
}

async function lookUpFacts(client: QueryClient, kind: CatalogKind, rows: readonly CatalogRow[], options: QueryOptions): Promise<FactsBySlug> {
  const slugs = rows.map((row) => String(row.slug));
  return readFacts((await ask(client, factsDocumentFor(kind), factVariablesOf(slugs, SEARCH_PAGE_ROWS), options)).data);
}

const withCardFacts = (rows: readonly CatalogRow[], factsBySlug: FactsBySlug): CatalogRow[] =>
  rows.map((row) => {
    const facts = factsBySlug.get(String(row.slug));
    return facts ? { ...row, ...Object.fromEntries(CARD_FACTS.map((key) => [key, facts[key]])) } : row;
  });

const isExplicit = (row: CatalogRow, factsBySlug: FactsBySlug): boolean => factsBySlug.get(String(row.slug))?.containExplicitThemes !== false;

export async function* streamCatalogMatches(
  client: QueryClient,
  kind: CatalogKind,
  { text, order, filters }: MatchQuery,
  options: QueryOptions,
  signal?: AbortSignal
): AsyncGenerator<CatalogRow[]> {
  let canStreamPages = order === null && filters.length === 0;
  const matches: CatalogRow[] = [];
  const factsBySlug = new Map<string, CatalogRow>();
  for await (const page of searchPages(client, kind, text, options, signal)) {
    if (signal?.aborted) return;
    const rows = page.slice(0, CATALOG_ROW_LIMIT - matches.length);
    for (const [slug, facts] of await lookUpFacts(client, kind, rows, options)) factsBySlug.set(slug, facts);
    matches.push(...rows);
    canStreamPages &&= !rows.some((row) => isExplicit(row, factsBySlug));
    if (canStreamPages) yield withCardFacts(matches, factsBySlug);
  }
  if (matches.length === 0) {
    yield [];
    return;
  }
  if (canStreamPages) return;
  const kept = matches.filter((match) => rowPasses(factsBySlug.get(String(match.slug)), filters));
  yield withCardFacts(order ? sortRows(kept, factsBySlug, order) : kept, factsBySlug);
}
