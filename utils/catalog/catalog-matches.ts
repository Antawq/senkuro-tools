import type { QueryClient } from '../shared/urql-client';
import { factVariablesOf, factsDocumentOf, readFacts } from './catalog-facts';
import { rowPasses, type CatalogFilters } from './catalog-filters';
import { CATALOG_ROW_LIMIT, SEARCH_PAGE_ROWS, type CatalogKind } from './catalog-results';
import { sortRows, type SortOrder } from './catalog-sort';

type Row = Record<string, unknown>;
type QueryOptions = Record<string, unknown> | undefined;

const CACHE_FIRST = { requestPolicy: 'cache-first' };

const factsDocuments = new Map<string, string>();

export interface MatchQuery {
  text: string;
  order: SortOrder | null;
  filters: CatalogFilters;
}

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

const factsDocumentFor = (kind: CatalogKind): string => {
  let document = factsDocuments.get(kind.operation);
  if (document === undefined) {
    document = factsDocumentOf(kind, CATALOG_ROW_LIMIT);
    factsDocuments.set(kind.operation, document);
  }
  return document;
};

async function ask(client: QueryClient, document: string, variables: Record<string, unknown>, options: QueryOptions): Promise<Row> {
  const answer = await client.query(document, variables, { ...options, ...CACHE_FIRST }).toPromise();
  return isRow(answer) ? answer : {};
}

async function* searchPages(client: QueryClient, kind: CatalogKind, text: string, options: QueryOptions): AsyncGenerator<Row[]> {
  let after: string | null = null;
  let totalCount = CATALOG_ROW_LIMIT;
  let loadedCount = 0;
  while (loadedCount < Math.min(totalCount, CATALOG_ROW_LIMIT)) {
    const answer = await ask(client, kind.searchDocument, { query: text, type: kind.searchType, first: SEARCH_PAGE_ROWS, after }, options);
    const search = isRow(answer.data) ? answer.data.search : null;
    if (!isRow(search) || !Array.isArray(search.edges)) return;
    const rows = search.edges.flatMap((edge: unknown) => (isRow(edge) && isRow(edge.node) && typeof edge.node.slug === 'string' ? [edge.node] : []));
    loadedCount += rows.length;
    if (rows.length > 0) yield rows;
    if (typeof search.totalCount === 'number') totalCount = search.totalCount;
    const pageInfo = isRow(search.pageInfo) ? search.pageInfo : {};
    if (pageInfo.hasNextPage !== true || typeof pageInfo.endCursor !== 'string' || search.edges.length === 0) return;
    after = pageInfo.endCursor;
  }
}

export async function* streamCatalogMatches(
  client: QueryClient,
  kind: CatalogKind,
  { text, order, filters }: MatchQuery,
  options: QueryOptions
): AsyncGenerator<Row[]> {
  const needsFacts = order !== null || filters.length > 0;
  const matches: Row[] = [];
  for await (const page of searchPages(client, kind, text, options)) {
    matches.push(...page);
    matches.length = Math.min(matches.length, CATALOG_ROW_LIMIT);
    if (!needsFacts) yield [...matches];
  }
  if (matches.length === 0) {
    yield [];
    return;
  }
  if (!needsFacts) return;
  const slugs = matches.map((match) => String(match.slug));
  const facts = readFacts((await ask(client, factsDocumentFor(kind), factVariablesOf(slugs, CATALOG_ROW_LIMIT), options)).data);
  const kept = matches.filter((match) => rowPasses(facts.get(String(match.slug)), filters));
  yield order ? sortRows(kept, facts, order) : kept;
}
