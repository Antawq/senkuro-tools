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
  factsAnswer,
  sourceOf,
  type Answer,
  type QueryCall,
} from './helpers/catalog-requests';

const rig = (
  catalogAnswers: Answer[] = [emptyCatalog],
  searchAnswers: Answer[] = [searchAnswer('naruto', 'boruto')],
  isHydrating = () => false,
  facts: Answer = { data: {} }
) => {
  const calls: QueryCall[] = [];
  const client = {
    executeQuery: () => sourceOf(catalogAnswers),
    executeMutation: () => null,
    query: (document: string, variables: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ document, variables, options });
      return promiseOf(document.includes('catalogRowFacts') ? facts : (searchAnswers[0] ?? {}));
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
  const searches = () => calls.filter((call) => !call.document.includes('catalogRowFacts'));
  const factRequests = () => calls.filter((call) => call.document.includes('catalogRowFacts'));
  return { calls, searches, factRequests, run };
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

  it('leaves a catalog with a filter it cannot apply, another page or no text as it is', async () => {
    const { calls, run } = rig();
    for (const variables of [
      { character: { include: ['ID'], exclude: [] } },
      { studio: { include: ['ID'], exclude: [] } },
      { after: 'cursor' },
      { search: '' },
      { search: undefined },
    ]) {
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
    const safe = factsAnswer({ naruto: { containExplicitThemes: false }, boruto: { containExplicitThemes: false } });
    const client = {
      executeQuery: () => sourceOf([emptyCatalog]),
      executeMutation: () => null,
      query: (document: string, variables: Record<string, unknown>) => {
        calls.push({ document, variables, options: undefined });
        return promiseOf(document.includes('catalogRowFacts') ? safe : (pages[String(variables.after)] ?? {}));
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
    const facts = factsAnswer({
      naruto: { score: 5, createdAt: '2020-01-01T00:00:00.000000' },
      boruto: { score: 9, createdAt: '2021-01-01T00:00:00.000000' },
    });
    const slugsOf = (seen: Answer[]) => rowsOf(seen[0]).map((edge) => edge.node.slug);

    it('puts the rows in the order of the field the page chose, asking for the values in one request', async () => {
      const { factRequests, run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, facts);
      const seen = await run(catalogRequest('fetchMangas', { orderField: 'SCORE', orderDirection: 'DESC' }));
      expect(slugsOf(seen)).toEqual(['boruto', 'naruto']);
      expect(factRequests()).toHaveLength(1);
      expect(factRequests()[0]?.options).toMatchObject({ requestPolicy: 'cache-first' });
    });

    it('turns the order around for the direction button', async () => {
      const { run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, facts);
      expect(slugsOf(await run(catalogRequest('fetchMangas', { orderField: 'SCORE', orderDirection: 'ASC' })))).toEqual(['naruto', 'boruto']);
    });

    it('keeps the order of the search for the popularity sort, which the API gives no field for', async () => {
      const { run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, facts);
      const seen = await run(catalogRequest('fetchMangas', { orderField: 'POPULARITY_SCORE', orderDirection: 'ASC' }));
      expect(slugsOf(seen)).toEqual(['naruto', 'boruto']);
    });

    it('keeps the order of the search when the values cannot be had', async () => {
      const { run } = rig([emptyCatalog], [searchAnswer('naruto', 'boruto')], () => false, { error: new Error('boom') });
      expect(slugsOf(await run(catalogRequest('fetchMangas', { orderField: 'SCORE' })))).toEqual(['naruto', 'boruto']);
    });
  });

  describe('the filters the page asks for', () => {
    const labels = (...slugs: string[]) => slugs.map((slug) => ({ slug }));
    const facts = factsAnswer({
      naruto: { labels: labels('male_protagonist', 'shounen'), status: 'FINISHED', score: 5, createdAt: '2020-01-01T00:00:00.000000' },
      boruto: { labels: labels('male_protagonist'), status: 'ONGOING', score: 9, createdAt: '2021-01-01T00:00:00.000000' },
      bleach: { labels: labels('shounen'), status: 'FINISHED', score: 7, createdAt: '2019-01-01T00:00:00.000000' },
    });
    const search = [searchAnswer('naruto', 'boruto', 'bleach')];
    const male = { label: { include: ['male_protagonist'], exclude: [] } };
    const slugsOf = (seen: Answer[]) => rowsOf(seen[0]).map((edge) => edge.node.slug);

    it('gives the page only the rows of the search that pass, which the catalog could not find for a text it cannot match', async () => {
      const { run } = rig([emptyCatalog], search, () => false, facts);
      expect(slugsOf(await run(catalogRequest('fetchMangas', male)))).toEqual(['naruto', 'boruto']);
    });

    it('asks for the values of the rows in one request that stays the same when only the filter changes', async () => {
      const { factRequests, searches, run } = rig([emptyCatalog], search, () => false, facts);
      await run(catalogRequest('fetchMangas', male));
      await run(catalogRequest('fetchMangas', { label: { include: ['shounen'], exclude: [] } }));
      expect(searches()).toHaveLength(2);
      expect(factRequests()).toHaveLength(2);
      expect(factRequests()[0]?.options).toMatchObject({ requestPolicy: 'cache-first' });
      expect(factRequests()[1]?.variables).toEqual(factRequests()[0]?.variables);
    });

    it('applies the filters and the sort together', async () => {
      const { run } = rig([emptyCatalog], search, () => false, facts);
      const seen = await run(catalogRequest('fetchMangas', { status: { include: ['FINISHED'], exclude: [] }, orderField: 'SCORE', orderDirection: 'DESC' }));
      expect(slugsOf(seen)).toEqual(['bleach', 'naruto']);
    });

    it('gives the catalog answer back when no row passes', async () => {
      const { run } = rig([emptyCatalog], search, () => false, facts);
      expect(await run(catalogRequest('fetchMangas', { label: { include: ['horror'], exclude: [] } }))).toEqual([emptyCatalog]);
    });

    it('leaves the catalog answer alone when it has rows, filters or not', async () => {
      const own: Answer = { data: { mangas: { edges: [{ node: { slug: 'x' } }] } } };
      const { calls, run } = rig([own], search, () => false, facts);
      expect(await run(catalogRequest('fetchMangas', male))).toEqual([own]);
      expect(calls).toHaveLength(0);
    });

    it('does the same for the anime catalog, with its own count of episodes', async () => {
      const animeFacts = factsAnswer({ naruto: { episodes: 220 }, boruto: { episodes: 293 }, bleach: { episodes: 366 } });
      const { run } = rig([{ data: { animes: { edges: [] } } }], search, () => false, animeFacts);
      const seen = await run(catalogRequest('fetchAnimes', { episodes: { start: 250, end: 400 } }));
      expect(rowsOf(seen[0], 'animes').map((edge) => edge.node.slug)).toEqual(['boruto', 'bleach']);
    });

    it('hands the page the empty answer first, then the rows that pass, while the page hydrates the server markup', async () => {
      const { run } = rig([emptyCatalog], search, () => true, facts);
      const seen = await run(catalogRequest('fetchMangas', male));
      expect(seen).toHaveLength(2);
      expect(rowsOf(seen[0])).toHaveLength(0);
      expect(rowsOf(seen[1]).map((edge) => edge.node.slug)).toEqual(['naruto', 'boruto']);
    });
  });
});
