export const CATALOG_SEARCH_PAGE_SIZE = 60;

type SearchFields = { status: string; type: string; rating: string };

export interface CatalogKind {
  operation: string;
  searchType: string;
  root: string;
  nodeTypename: string;
  searchFields: SearchFields;
  searchDocument: string;
}

const COVER_SELECTION = '{ id blurhash original { height width url __typename } preview: resize(width: 175, height: 250) { url __typename } __typename }';

const searchDocumentOf = (nodeTypename: string, fields: SearchFields): string =>
  `query catalogSearch($query: String!, $type: SearchType!) { search(query: $query, type: $type, first: ${CATALOG_SEARCH_PAGE_SIZE}) { edges { node { ` +
  `... on Search${nodeTypename} { id slug originalName titles { lang content __typename } ${fields.type}: type ${fields.status}: status ${fields.rating}: rating score cover ${COVER_SELECTION} } } } } }`;

const defineKind = (operation: string, searchType: string, root: string, nodeTypename: string, searchFields: SearchFields): CatalogKind => ({
  operation,
  searchType,
  root,
  nodeTypename,
  searchFields,
  searchDocument: searchDocumentOf(nodeTypename, searchFields),
});

const CATALOG_KINDS: readonly CatalogKind[] = [
  defineKind('fetchMangas', 'MANGA', 'mangas', 'Manga', { status: 'mangaStatus', type: 'mangaType', rating: 'mangaRating' }),
  defineKind('fetchAnimes', 'ANIME', 'animes', 'Anime', { status: 'animeStatus', type: 'animeType', rating: 'animeRating' }),
];

const SEARCH_VARIABLE = 'search';
const SORT_VARIABLES: ReadonlySet<string> = new Set(['orderField', 'orderDirection']);
const TITLE_TYPENAME = 'I18nTitle';
const ORIGINAL_NAME_LANGUAGE = 'JA';

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

const isEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRow(value) && Object.values(value).every(isEmptyValue);
};

export const catalogKindOf = (operation: string | undefined): CatalogKind | undefined => CATALOG_KINDS.find((kind) => kind.operation === operation);

export function asksOnlyForSearch(variables: Row | undefined): string | null {
  const text = variables?.[SEARCH_VARIABLE];
  if (!variables || typeof text !== 'string' || text.trim() === '') return null;
  const hasOtherFilter = Object.entries(variables).some(([name, value]) => name !== SEARCH_VARIABLE && !SORT_VARIABLES.has(name) && !isEmptyValue(value));
  return hasOtherFilter ? null : text.trim();
}

export function isEmptyCatalogAnswer(answer: { data?: unknown; error?: unknown }, kind: CatalogKind): boolean {
  if (answer.error !== undefined && answer.error !== null) return true;
  const edges = isRow(answer.data) && isRow(answer.data[kind.root]) ? (answer.data[kind.root] as Row).edges : undefined;
  return !Array.isArray(edges) || edges.length === 0;
}

function catalogNodeOf(node: Row, kind: CatalogKind): Row {
  const originalName = node.originalName;
  return {
    id: node.id,
    slug: node.slug,
    originalName: typeof originalName === 'string' ? { lang: ORIGINAL_NAME_LANGUAGE, content: originalName, __typename: TITLE_TYPENAME } : originalName,
    titles: node.titles,
    status: node[kind.searchFields.status],
    type: node[kind.searchFields.type],
    formats: [],
    rating: node[kind.searchFields.rating],
    score: node.score,
    containExplicitThemes: false,
    cover: node.cover,
    viewerBookmark: null,
    __typename: kind.nodeTypename,
  };
}

export function toCatalogData(searchData: unknown, kind: CatalogKind): Row | null {
  const search = isRow(searchData) ? searchData.search : null;
  const searchEdges = isRow(search) && Array.isArray(search.edges) ? (search.edges as unknown[]) : [];
  const edges = searchEdges.flatMap((edge) =>
    isRow(edge) && isRow(edge.node) ? [{ node: catalogNodeOf(edge.node, kind), __typename: `${kind.nodeTypename}Edge` }] : []
  );
  if (edges.length === 0) return null;
  return { [kind.root]: { edges, pageInfo: { hasNextPage: false, endCursor: null, __typename: 'PageInfo' }, __typename: `${kind.nodeTypename}Connection` } };
}
