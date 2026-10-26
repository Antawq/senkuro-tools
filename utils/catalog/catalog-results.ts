import { isCatalogRow, type CatalogRow } from './catalog-row';

export const SEARCH_PAGE_ROWS = 100;
export const CATALOG_ROW_LIMIT = 300;

type SearchFields = { status: string; type: string; rating: string };

export interface FilterSpec {
  fact: string;
  rule: 'one' | 'all' | 'label' | 'count' | 'date';
}

export interface CatalogKind {
  operation: string;
  searchType: string;
  root: string;
  nodeTypename: string;
  searchFields: SearchFields;
  searchDocument: string;
  lookupRoot: string;
  lookupSelection: string;
  sortKeys: Readonly<Record<string, string>>;
  filters: Readonly<Record<string, FilterSpec>>;
}

interface KindRowOptions {
  lookupRoot: string;
  lookupSelection: string;
  sortKeys: Record<string, string>;
  filters: Record<string, FilterSpec>;
}

const COVER_SELECTION = '{ id blurhash original { height width url __typename } preview: resize(width: 175, height: 250) { url __typename } __typename }';

const searchDocumentOf = (nodeTypename: string, fields: SearchFields): string =>
  'query catalogSearch($query: String!, $type: SearchType!, $first: Int, $after: String) { ' +
  'search(query: $query, type: $type, first: $first, after: $after) { totalCount pageInfo { hasNextPage endCursor } edges { node { ' +
  `... on Search${nodeTypename} { id slug originalName titles { lang content __typename } ${fields.type}: type ${fields.status}: status ${fields.rating}: rating score cover ${COVER_SELECTION} } } } } }`;

const defineKind = (
  operation: string,
  searchType: string,
  root: string,
  nodeTypename: string,
  searchFields: SearchFields,
  row: KindRowOptions
): CatalogKind => ({
  operation,
  searchType,
  root,
  nodeTypename,
  searchFields,
  searchDocument: searchDocumentOf(nodeTypename, searchFields),
  ...row,
});

const FILTERED_FACTS = 'type formats status source rating originCountry releasedOn completedOn translitionStatus labels { slug }';

const sharedFilters: Record<string, FilterSpec> = {
  type: { fact: 'type', rule: 'one' },
  format: { fact: 'formats', rule: 'all' },
  status: { fact: 'status', rule: 'one' },
  source: { fact: 'source', rule: 'one' },
  rating: { fact: 'rating', rule: 'one' },
  originCountry: { fact: 'originCountry', rule: 'one' },
  translitionStatus: { fact: 'translitionStatus', rule: 'one' },
  releasedOn: { fact: 'releasedOn', rule: 'date' },
  completedOn: { fact: 'completedOn', rule: 'date' },
  label: { fact: 'labels', rule: 'label' },
};

const CATALOG_KINDS: readonly CatalogKind[] = [
  defineKind(
    'fetchMangas',
    'MANGA',
    'mangas',
    'Manga',
    { status: 'mangaStatus', type: 'mangaType', rating: 'mangaRating' },
    {
      lookupRoot: 'manga',
      lookupSelection: `chapters lastChapterAt ${FILTERED_FACTS}`,
      sortKeys: { SCORE: 'score', VIEWS: 'views', CHAPTERS: 'chapters', CREATED_AT: 'createdAt', LAST_CHAPTER_AT: 'lastChapterAt' },
      filters: { ...sharedFilters, chapters: { fact: 'chapters', rule: 'count' } },
    }
  ),
  defineKind(
    'fetchAnimes',
    'ANIME',
    'animes',
    'Anime',
    { status: 'animeStatus', type: 'animeType', rating: 'animeRating' },
    {
      lookupRoot: 'anime',
      lookupSelection: `episodes lastEpisodeAt ${FILTERED_FACTS}`,
      sortKeys: { SCORE: 'score', VIEWS: 'views', EPISODES: 'episodes', CREATED_AT: 'createdAt', LAST_EPISODE_AT: 'lastEpisodeAt' },
      filters: { ...sharedFilters, episodes: { fact: 'episodes', rule: 'count' } },
    }
  ),
];

const TITLE_TYPENAME = 'I18nTitle';
const ORIGINAL_NAME_LANGUAGE = 'JA';

export const catalogKindOf = (operation: string | undefined): CatalogKind | undefined => CATALOG_KINDS.find((kind) => kind.operation === operation);

export function isEmptyCatalogAnswer(answer: { data?: unknown; error?: unknown }, kind: CatalogKind): boolean {
  if (answer.error !== undefined && answer.error !== null) return true;
  const edges = isCatalogRow(answer.data) && isCatalogRow(answer.data[kind.root]) ? (answer.data[kind.root] as CatalogRow).edges : undefined;
  return !Array.isArray(edges) || edges.length === 0;
}

function catalogNodeOf(node: CatalogRow, kind: CatalogKind): CatalogRow {
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

export function toCatalogData(rows: readonly CatalogRow[], kind: CatalogKind): CatalogRow | null {
  const edges = rows.map((node) => ({ node: catalogNodeOf(node, kind), __typename: `${kind.nodeTypename}Edge` }));
  if (edges.length === 0) return null;
  return { [kind.root]: { edges, pageInfo: { hasNextPage: false, endCursor: null, __typename: 'PageInfo' }, __typename: `${kind.nodeTypename}Connection` } };
}
