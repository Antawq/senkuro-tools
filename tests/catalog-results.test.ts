import { describe, expect, it } from 'vitest';

import { catalogKindOf, isEmptyCatalogAnswer, toCatalogData } from '../utils/catalog/catalog-results';

describe('catalogKindOf', () => {
  it('knows the manga and the anime catalog by the operation the page sends', () => {
    expect(catalogKindOf('fetchMangas')?.searchType).toBe('MANGA');
    expect(catalogKindOf('fetchAnimes')?.searchType).toBe('ANIME');
  });

  it('names the sort values the catalog offers and the field of the API each one is read from', () => {
    expect(catalogKindOf('fetchMangas')?.sortKeys).toEqual({
      SCORE: 'score',
      VIEWS: 'views',
      CHAPTERS: 'chapters',
      CREATED_AT: 'createdAt',
      LAST_CHAPTER_AT: 'lastChapterAt',
    });
    expect(catalogKindOf('fetchAnimes')?.sortKeys).toEqual({
      SCORE: 'score',
      VIEWS: 'views',
      EPISODES: 'episodes',
      CREATED_AT: 'createdAt',
      LAST_EPISODE_AT: 'lastEpisodeAt',
    });
    expect(catalogKindOf('fetchMangas')?.lookupRoot).toBe('manga');
    expect(catalogKindOf('fetchAnimes')?.lookupRoot).toBe('anime');
  });

  it('names the filters the catalog offers and the fact of the lookup each one is read from, with the count of chapters or of episodes by catalog', () => {
    const manga = catalogKindOf('fetchMangas')?.filters ?? {};
    const anime = catalogKindOf('fetchAnimes')?.filters ?? {};
    expect(Object.keys(manga).sort()).toEqual([
      'chapters',
      'completedOn',
      'format',
      'label',
      'originCountry',
      'rating',
      'releasedOn',
      'source',
      'status',
      'translitionStatus',
      'type',
    ]);
    expect(Object.keys(anime).sort()).toEqual([
      'completedOn',
      'episodes',
      'format',
      'label',
      'originCountry',
      'rating',
      'releasedOn',
      'source',
      'status',
      'translitionStatus',
      'type',
    ]);
    expect(manga.format).toEqual({ fact: 'formats', rule: 'all' });
    expect(manga.label).toEqual({ fact: 'labels', rule: 'label' });
    expect(manga.chapters).toEqual({ fact: 'chapters', rule: 'count' });
    expect(anime.episodes).toEqual({ fact: 'episodes', rule: 'count' });
    expect(anime.releasedOn).toEqual({ fact: 'releasedOn', rule: 'date' });
  });

  it('knows no other operation', () => {
    for (const name of ['search', 'fetchUserCards', 'fetchRanobes', '', undefined]) expect(catalogKindOf(name)).toBeUndefined();
  });

  it('carries a search document of its own that names the fields the catalog node is built from', () => {
    const manga = catalogKindOf('fetchMangas')?.searchDocument ?? '';
    const anime = catalogKindOf('fetchAnimes')?.searchDocument ?? '';
    expect(manga).toContain('... on SearchManga');
    expect(manga).toContain('preview: resize(');
    expect(manga).toContain('search(query: $query, type: $type, first: $first, after: $after)');
    expect(manga).toContain('totalCount pageInfo { hasNextPage endCursor }');
    for (const field of ['mangaType: type', 'mangaStatus: status', 'mangaRating: rating']) expect(manga).toContain(field);
    expect(anime).toContain('... on SearchAnime');
    for (const field of ['animeType: type', 'animeStatus: status', 'animeRating: rating']) expect(anime).toContain(field);
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
    const data = toCatalogData([{ ...searchNode, containExplicitThemes: false, formats: ['WEB'] }], catalogKindOf('fetchMangas')!);
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
              formats: ['WEB'],
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
    const data = toCatalogData([animeNode], catalogKindOf('fetchAnimes')!) as {
      animes: { edges: { node: Record<string, unknown> }[]; __typename: string };
    };
    expect(data.animes.__typename).toBe('AnimeConnection');
    expect(data.animes.edges[0]?.node).toMatchObject({ status: 'FINISHED', type: 'TV', rating: 'PG13', __typename: 'Anime' });
  });

  it('marks a row 18+ unless its lookup said otherwise, so the catalog asks for the age and blurs the cover as it does for its own rows', () => {
    const nodesOf = (rows: Record<string, unknown>[]) =>
      (toCatalogData(rows, catalogKindOf('fetchMangas')!) as { mangas: { edges: { node: Record<string, unknown> }[] } }).mangas.edges.map((edge) => edge.node);
    const [explicit, safe, unknown] = nodesOf([
      { ...searchNode, slug: 'a', containExplicitThemes: true },
      { ...searchNode, slug: 'b', containExplicitThemes: false },
      { ...searchNode, slug: 'c' },
    ]);
    expect([explicit?.containExplicitThemes, safe?.containExplicitThemes, unknown?.containExplicitThemes]).toEqual([true, false, true]);
    expect(unknown?.formats).toEqual([]);
  });

  it('gives nothing when there are no rows to give', () => {
    expect(toCatalogData([], catalogKindOf('fetchMangas')!)).toBeNull();
  });

  it('keeps the rows in the order it is given them, so a sort made before it shows', () => {
    const data = toCatalogData([searchNode, { ...searchNode, id: 'ID2', slug: 'boruto' }], catalogKindOf('fetchMangas')!) as {
      mangas: { edges: { node: { slug: string } }[] };
    };
    expect(data.mangas.edges.map((edge) => edge.node.slug)).toEqual(['naruto', 'boruto']);
  });
});
