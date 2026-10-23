import { describe, expect, it } from 'vitest';

import { pipe, subscribe, type Source } from 'wonka';

import { installCatalogFallback } from '../utils/catalog/catalog-fallback';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';
import {
  catalogRequest,
  emptyCatalog,
  promiseOf,
  rowsOf,
  searchAnswer,
  searchPage,
  settle,
  sortKeysAnswer,
  sourceOf,
  type Answer,
  type QueryCall,
} from './helpers/catalog-requests';

const rig = (
  catalogAnswers: Answer[] = [emptyCatalog],
  searchAnswers: Answer[] = [searchAnswer('naruto', 'boruto')],
  isHydrating = () => false,
  sortKeys: Answer = { data: {} }
) => {
  const calls: QueryCall[] = [];
  const client = {
    executeQuery: () => sourceOf(catalogAnswers),
    executeMutation: () => null,
    query: (document: string, variables: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ document, variables, options });
      return promiseOf(document.includes('catalogSortKeys') ? sortKeys : (searchAnswers[0] ?? {}));
    },
  } as unknown as QueryClient;
  installCatalogFallback(client, isHydrating);
  const run = async (asked: QueryRequest): Promise<Answer[]> => {
    const seen: Answer[] = [];
    pipe(
      client.executeQuery(asked) as Source<Answer>,
      subscribe((answer) => seen.push(answer))
    );
    await settle();
    return seen;
  };
  const searches = () => calls.filter((call) => !call.document.includes('catalogSortKeys'));
  const sortRequests = () => calls.filter((call) => call.document.includes('catalogSortKeys'));
  return { calls, searches, sortRequests, run };
};

describe('installCatalogFallback', () => {
  it('asks the search that finds Russian for the text, many rows at a time, when the catalog finds nothing', async () => {
    const { searches, run } = rig();
    await run(catalogRequest('fetchMangas'));
    expect(searches()).toHaveLength(1);
    expect(searches()[0]?.variables).toMatchObject({ query: 'наруто', type: 'MANGA', first: 100, after: null });
    expect(searches()[0]?.document).toContain('... on SearchManga');
  });

  it('asks with a document of its own and keeps its own queries on the cache, so a changed sort does not ask again', async () => {
    const { searches, run } = rig();
    await run(catalogRequest('fetchMangas'));
    expect(typeof searches()[0]?.document).toBe('string');
    expect(searches()[0]?.options).toMatchObject({ requestPolicy: 'cache-first' });
  });

  it('gives the page the rows of the search in the shape of its own answer', async () => {
    const { run } = rig();
    const seen = await run(catalogRequest('fetchMangas'));
    expect(seen).toHaveLength(1);
    expect(rowsOf(seen[0]).map((edge) => edge.node.slug)).toEqual(['naruto', 'boruto']);
    expect(rowsOf(seen[0])[0]?.node.status).toBe('FINISHED');
    expect(seen[0]?.error).toBeUndefined();
  });

  it('does the same for the anime catalog, with the anime search', async () => {
    const animeSearch = {
      data: {
        search: {
          totalCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [{ node: { id: '1', slug: 'naruto', originalName: 'Naruto', titles: [], animeStatus: 'FINISHED' } }],
        },
      },
    };
    const { searches, run } = rig([{ data: { animes: { edges: [] } } }], [animeSearch]);
    const seen = await run(catalogRequest('fetchAnimes'));
    expect(searches()[0]?.variables.type).toBe('ANIME');
    expect(searches()[0]?.document).toContain('... on SearchAnime');
    expect(rowsOf(seen[0], 'animes')).toHaveLength(1);
  });

  it('answers when the catalog answers with an error too', async () => {
    const { run } = rig([{ error: new Error('boom') }]);
    const seen = await run(catalogRequest('fetchMangas'));
    expect(rowsOf(seen[0])).toHaveLength(2);
    expect(seen[0]?.error).toBeUndefined();
  });

  it('leaves the catalog answer alone when it has rows', async () => {
    const own: Answer = { data: { mangas: { edges: [{ node: { slug: 'x' } }] } } };
    const { calls, run } = rig([own]);
    expect(await run(catalogRequest('fetchMangas'))).toEqual([own]);
    expect(calls).toHaveLength(0);
  });

  it('does not take a cached answer for the last word, and waits for the settled one', async () => {
    const { calls, run } = rig([{ ...emptyCatalog, stale: true }, { data: { mangas: { edges: [{ node: { slug: 'x' } }] } } }]);
    const seen = await run(catalogRequest('fetchMangas'));
    expect(calls).toHaveLength(0);
    expect(seen).toHaveLength(2);
  });

  it('leaves a catalog with another filter, another page or no text as it is', async () => {
    const { calls, run } = rig();
    for (const variables of [{ status: { include: ['ONGOING'], exclude: [] } }, { after: 'cursor' }, { search: '' }, { search: undefined }]) {
      expect(await run(catalogRequest('fetchMangas', variables))).toEqual([emptyCatalog]);
    }
    expect(calls).toHaveLength(0);
  });

  it('gives the catalog answer back when the search has nothing or fails', async () => {
    for (const searchAnswers of [[searchAnswer()], [{ error: new Error('boom') }], [{ data: null }]]) {
      const { run } = rig([emptyCatalog], searchAnswers);
      expect(await run(catalogRequest('fetchMangas'))).toEqual([emptyCatalog]);
    }
  });

  it('hands the page the empty answer first, then the rows, while the page hydrates the server markup', async () => {
    const { run } = rig([emptyCatalog], [searchAnswer('naruto')], () => true);
    for (const search of ['НАРУТО', 'БЛИЧ']) {
      const seen = await run(catalogRequest('fetchMangas', { search }));
      expect(seen).toHaveLength(2);
      expect(rowsOf(seen[0])).toHaveLength(0);
      expect(rowsOf(seen[1]).map((edge) => edge.node.slug)).toEqual(['naruto']);
    }
  });

  it('answers with the rows at once when the page is not hydrating', async () => {
    let isHydrating = true;
    const { run } = rig([emptyCatalog], [searchAnswer('naruto')], () => isHydrating);
    expect(await run(catalogRequest('fetchMangas'))).toHaveLength(2);
    isHydrating = false;
    expect(await run(catalogRequest('fetchMangas'))).toHaveLength(1);
  });

  it('leaves every other operation exactly as it is', async () => {
    const { calls, run } = rig();
    expect(await run(catalogRequest('fetchRanobes'))).toEqual([emptyCatalog]);
    expect(calls).toHaveLength(0);
  });

  it('gives the page the first rows as soon as they are there, and the rest when the pages have come, when there is no sort to make', async () => {
    const calls: QueryCall[] = [];
    const pages: Record<string, Answer> = { null: searchPage(['naruto'], 2, '1'), '1': searchPage(['boruto'], 2) };
    const client = {
      executeQuery: () => sourceOf([emptyCatalog]),
      executeMutation: () => null,
      query: (document: string, variables: Record<string, unknown>) => {
        calls.push({ document, variables, options: undefined });
        return promiseOf(pages[String(variables.after)] ?? {});
      },
    } as unknown as QueryClient;
    installCatalogFallback(client, () => false);
    const seen: Answer[] = [];
    pipe(
      client.executeQuery(catalogRequest('fetchMangas')) as Source<Answer>,
      subscribe((answer) => seen.push(answer))
    );
    await settle();
    expect(seen.map((answer) => rowsOf(answer).map((edge) => edge.node.slug))).toEqual([['naruto'], ['naruto', 'boruto']]);
  });

  describe('the sort the page asks for', () => {
    const keys = sortKeysAnswer({
      naruto: { score: 5, createdAt: '2020-01-01T00:00:00.000000' },
      boruto: { score: 9, createdAt: '2021-01-01T00:00:00.000000' },
    });
    const slugsOf = (seen: Answer[]) => rowsOf(seen[0]).map((edge) => edge.node.slug);

    it('puts the rows in the order of the field the page chose, asking for the values in one request', async () => {
      const { sortRequests, run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, keys);
      const seen = await run(catalogRequest('fetchMangas', { orderField: 'SCORE', orderDirection: 'DESC' }));
      expect(slugsOf(seen)).toEqual(['boruto', 'naruto']);
      expect(sortRequests()).toHaveLength(1);
      expect(sortRequests()[0]?.options).toMatchObject({ requestPolicy: 'cache-first' });
    });

    it('turns the order around for the direction button', async () => {
      const { run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, keys);
      expect(slugsOf(await run(catalogRequest('fetchMangas', { orderField: 'SCORE', orderDirection: 'ASC' })))).toEqual(['naruto', 'boruto']);
    });

    it('keeps the order of the search for the popularity sort, which the API gives no field for, and asks for no values', async () => {
      const { sortRequests, run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, keys);
      const seen = await run(catalogRequest('fetchMangas', { orderField: 'POPULARITY_SCORE', orderDirection: 'ASC' }));
      expect(slugsOf(seen)).toEqual(['naruto', 'boruto']);
      expect(sortRequests()).toHaveLength(0);
    });

    it('keeps the order of the search when the values cannot be had', async () => {
      const { run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, { error: new Error('boom') });
      expect(slugsOf(await run(catalogRequest('fetchMangas', { orderField: 'SCORE' })))).toEqual(['naruto', 'boruto']);
    });
  });
});
