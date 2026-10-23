import { describe, expect, it } from 'vitest';

import { asksOnlyForSearch, CATALOG_SEARCH_PAGE_SIZE, catalogKindOf, isEmptyCatalogAnswer, toCatalogData } from '../utils/catalog/catalog-results';

const NO_FILTERS = {
  after: null,
  bookmarkCollections: { exclude: [], include: [] },
  chapters: {},
  format: { exclude: [], include: [] },
  label: { exclude: [], include: [] },
  orderDirection: 'DESC',
  orderField: 'POPULARITY_SCORE',
  originCountry: { exclude: [], include: [] },
  rating: { exclude: [], include: [] },
  releasedOn: {},
  source: { exclude: [], include: [] },
  status: { exclude: [], include: [] },
  translitionStatus: { exclude: [], include: [] },
  type: { exclude: [], include: [] },
};

describe('catalogKindOf', () => {
  it('knows the manga and the anime catalog by the operation the page sends', () => {
    expect(catalogKindOf('fetchMangas')?.searchType).toBe('MANGA');
    expect(catalogKindOf('fetchAnimes')?.searchType).toBe('ANIME');
  });

  it('knows no other operation', () => {
    for (const name of ['search', 'fetchUserCards', 'fetchRanobes', '', undefined]) expect(catalogKindOf(name)).toBeUndefined();
  });

  it('carries a search document of its own that names the fields the catalog node is built from', () => {
    const manga = catalogKindOf('fetchMangas')?.searchDocument ?? '';
    const anime = catalogKindOf('fetchAnimes')?.searchDocument ?? '';
    expect(manga).toContain('... on SearchManga');
    expect(manga).toContain('preview: resize(');
    expect(manga).toContain(`first: ${CATALOG_SEARCH_PAGE_SIZE})`);
    for (const field of ['mangaType: type', 'mangaStatus: status', 'mangaRating: rating']) expect(manga).toContain(field);
    expect(anime).toContain('... on SearchAnime');
    for (const field of ['animeType: type', 'animeStatus: status', 'animeRating: rating']) expect(anime).toContain(field);
  });
});

describe('asksOnlyForSearch', () => {
  it('gives the text when the search is the only thing asked for, whatever the order', () => {
    expect(asksOnlyForSearch({ ...NO_FILTERS, search: 'НАРУТО' })).toBe('НАРУТО');
    expect(asksOnlyForSearch({ ...NO_FILTERS, orderField: 'RATING', orderDirection: 'ASC', search: ' one piece ' })).toBe('one piece');
  });

  it('gives nothing without a text to search', () => {
    for (const search of [undefined, null, '', '   ', 5, ['a']]) expect(asksOnlyForSearch({ ...NO_FILTERS, search })).toBeNull();
    expect(asksOnlyForSearch(undefined)).toBeNull();
  });

  it('gives nothing when another filter is set, so a filtered catalog stays filtered', () => {
    expect(asksOnlyForSearch({ ...NO_FILTERS, search: 'x', status: { include: ['ONGOING'], exclude: [] } })).toBeNull();
    expect(asksOnlyForSearch({ ...NO_FILTERS, search: 'x', releasedOn: { start: '2020-01-01' } })).toBeNull();
    expect(asksOnlyForSearch({ ...NO_FILTERS, search: 'x', label: { include: ['id'], exclude: [] } })).toBeNull();
  });

  it('gives nothing for a later page, which the search would only repeat', () => {
    expect(asksOnlyForSearch({ ...NO_FILTERS, after: 'cursor', search: 'x' })).toBeNull();
  });
});

describe('isEmptyCatalogAnswer', () => {
  const kind = catalogKindOf('fetchMangas');
  it('is true for an answer with an error, with no list, or with no rows', () => {
    expect(isEmptyCatalogAnswer({ error: new Error('x') }, kind!)).toBe(true);
    expect(isEmptyCatalogAnswer({}, kind!)).toBe(true);
    expect(isEmptyCatalogAnswer({ data: { mangas: null } }, kind!)).toBe(true);
    expect(isEmptyCatalogAnswer({ data: { mangas: { edges: [] } } }, kind!)).toBe(true);
  });

  it('is false for an answer with rows', () => {
    expect(isEmptyCatalogAnswer({ data: { mangas: { edges: [{ node: { slug: 'naruto' } }] } } }, kind!)).toBe(false);
  });
});

describe('toCatalogData', () => {
  const searchNode = {
    id: 'ID1',
    slug: 'naruto',
    originalName: 'Naruto',
    titles: [{ lang: 'RU', content: 'Наруто', __typename: 'I18nTitle' }],
    mangaType: 'MANGA',
    mangaStatus: 'FINISHED',
    mangaRating: 'ALL',
    translitionStatus: 'FINISHED',
    score: 8.1,
    cover: { id: 'C1', preview: { url: 'p' } },
    __typename: 'SearchManga',
  };

  it('gives the rows of the search to the page the way the catalog gives its own', () => {
    const data = toCatalogData({ search: { edges: [{ node: searchNode, __typename: 'SearchMangaEdge' }] } }, catalogKindOf('fetchMangas')!);
    expect(data).toEqual({
      mangas: {
        edges: [
          {
            node: {
              id: 'ID1',
              slug: 'naruto',
              originalName: { lang: 'JA', content: 'Naruto', __typename: 'I18nTitle' },
              titles: [{ lang: 'RU', content: 'Наруто', __typename: 'I18nTitle' }],
              status: 'FINISHED',
              type: 'MANGA',
              formats: [],
              rating: 'ALL',
              score: 8.1,
              containExplicitThemes: false,
              cover: { id: 'C1', preview: { url: 'p' } },
              viewerBookmark: null,
              __typename: 'Manga',
            },
            __typename: 'MangaEdge',
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null, __typename: 'PageInfo' },
        __typename: 'MangaConnection',
      },
    });
  });

  it('does the same for the anime catalog with the anime names of the fields', () => {
    const animeNode = {
      id: 'A1',
      slug: 'naruto',
      originalName: 'Naruto',
      titles: [],
      animeType: 'TV',
      animeStatus: 'FINISHED',
      animeRating: 'PG13',
      score: 8,
      cover: null,
      __typename: 'SearchAnime',
    };
    const data = toCatalogData({ search: { edges: [{ node: animeNode }] } }, catalogKindOf('fetchAnimes')!) as {
      animes: { edges: { node: Record<string, unknown> }[]; __typename: string };
    };
    expect(data.animes.__typename).toBe('AnimeConnection');
    expect(data.animes.edges[0]?.node).toMatchObject({ status: 'FINISHED', type: 'TV', rating: 'PG13', __typename: 'Anime' });
  });

  it('gives nothing when the search has no rows to give, or is not a search answer', () => {
    const kind = catalogKindOf('fetchMangas')!;
    for (const data of [{ search: { edges: [] } }, { search: null }, {}, null, undefined]) expect(toCatalogData(data, kind)).toBeNull();
  });

  it('skips a row it cannot read instead of failing on it', () => {
    const data = toCatalogData({ search: { edges: [{ node: null }, { node: searchNode }, {}] } }, catalogKindOf('fetchMangas')!) as {
      mangas: { edges: unknown[] };
    };
    expect(data.mangas.edges).toHaveLength(1);
  });
});
