import { describe, expect, it } from 'vitest';

import { pipe, subscribe, type Source } from 'wonka';

import { installCatalogFallback } from '../utils/catalog/catalog-fallback';
import { CATALOG_SEARCH_PAGE_SIZE } from '../utils/catalog/catalog-results';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';
import { catalogRequest, emptyCatalog, rowsOf, searchAnswer, sourceOf, type Answer } from './helpers/catalog-requests';

const rig = (catalogAnswers: Answer[] = [emptyCatalog], searchAnswers: Answer[] = [searchAnswer('naruto', 'boruto')], isHydrating = () => false) => {
  const searches: { document: unknown; variables: Record<string, unknown>; options: unknown }[] = [];
  const client = {
    executeQuery: () => sourceOf(catalogAnswers),
    executeMutation: () => null,
    query: (document: unknown, variables: Record<string, unknown>, options: unknown) => {
      searches.push({ document, variables, options });
      return sourceOf(searchAnswers);
    },
  } as unknown as QueryClient;
  installCatalogFallback(client, isHydrating);
  const run = (asked: QueryRequest): Answer[] => {
    const seen: Answer[] = [];
    pipe(
      client.executeQuery(asked) as Source<Answer>,
      subscribe((answer) => seen.push(answer))
    );
    return seen;
  };
  return { searches, run };
};

describe('installCatalogFallback', () => {
  it('asks the search that finds Russian for the text, many rows at a time, when the catalog finds nothing', () => {
    const { searches, run } = rig();
    run(catalogRequest('fetchMangas'));
    expect(searches).toHaveLength(1);
    expect(searches[0]?.variables).toEqual({ query: 'наруто', type: 'MANGA' });
    expect(searches[0]?.document).toContain(`first: ${CATALOG_SEARCH_PAGE_SIZE})`);
    expect(searches[0]?.document).toContain('... on SearchManga');
  });

  it('asks with a document of its own, so it needs no search the page made before', () => {
    const { searches, run } = rig();
    run(catalogRequest('fetchMangas'));
    expect(typeof searches[0]?.document).toBe('string');
  });

  it('gives the page the rows of the search in the shape of its own answer', () => {
    const { run } = rig();
    const seen = run(catalogRequest('fetchMangas'));
    expect(seen).toHaveLength(1);
    expect(rowsOf(seen[0]).map((edge) => edge.node.slug)).toEqual(['naruto', 'boruto']);
    expect(rowsOf(seen[0])[0]?.node.status).toBe('FINISHED');
    expect(seen[0]?.error).toBeUndefined();
  });

  it('does the same for the anime catalog, with the anime search', () => {
    const animeSearch = { data: { search: { edges: [{ node: { id: '1', slug: 'naruto', originalName: 'Naruto', titles: [], animeStatus: 'FINISHED' } }] } } };
    const { searches, run } = rig([{ data: { animes: { edges: [] } } }], [animeSearch]);
    const seen = run(catalogRequest('fetchAnimes'));
    expect(searches[0]?.variables.type).toBe('ANIME');
    expect(searches[0]?.document).toContain('... on SearchAnime');
    expect(rowsOf(seen[0], 'animes')).toHaveLength(1);
  });

  it('answers when the catalog answers with an error too', () => {
    const { run } = rig([{ error: new Error('boom') }]);
    const seen = run(catalogRequest('fetchMangas'));
    expect(rowsOf(seen[0])).toHaveLength(2);
    expect(seen[0]?.error).toBeUndefined();
  });

  it('leaves the catalog answer alone when it has rows', () => {
    const own: Answer = { data: { mangas: { edges: [{ node: { slug: 'x' } }] } } };
    const { searches, run } = rig([own]);
    expect(run(catalogRequest('fetchMangas'))).toEqual([own]);
    expect(searches).toHaveLength(0);
  });

  it('does not take a cached answer for the last word, and waits for the settled one', () => {
    const { searches, run } = rig([{ ...emptyCatalog, stale: true }, { data: { mangas: { edges: [{ node: { slug: 'x' } }] } } }]);
    const seen = run(catalogRequest('fetchMangas'));
    expect(searches).toHaveLength(0);
    expect(seen).toHaveLength(2);
  });

  it('leaves a catalog with another filter, another page or no text as it is', () => {
    const { searches, run } = rig();
    for (const variables of [{ status: { include: ['ONGOING'], exclude: [] } }, { after: 'cursor' }, { search: '' }, { search: undefined }]) {
      expect(run(catalogRequest('fetchMangas', variables))).toEqual([emptyCatalog]);
    }
    expect(searches).toHaveLength(0);
  });

  it('gives the catalog answer back when the search has nothing or fails', () => {
    for (const searchAnswers of [[searchAnswer()], [{ error: new Error('boom') }], [{ data: null }]]) {
      const { run } = rig([emptyCatalog], searchAnswers);
      expect(run(catalogRequest('fetchMangas'))).toEqual([emptyCatalog]);
    }
  });

  it('hands the page the empty answer first, then the rows, while the page hydrates the server markup', () => {
    const { run } = rig([emptyCatalog], [searchAnswer('naruto')], () => true);
    for (const search of ['НАРУТО', 'БЛИЧ']) {
      const seen = run(catalogRequest('fetchMangas', { search }));
      expect(seen).toHaveLength(2);
      expect(rowsOf(seen[0])).toHaveLength(0);
      expect(rowsOf(seen[1]).map((edge) => edge.node.slug)).toEqual(['naruto']);
    }
  });

  it('answers with the rows at once when the page is not hydrating', () => {
    let isHydrating = true;
    const { run } = rig([emptyCatalog], [searchAnswer('naruto')], () => isHydrating);
    expect(run(catalogRequest('fetchMangas'))).toHaveLength(2);
    isHydrating = false;
    expect(run(catalogRequest('fetchMangas'))).toHaveLength(1);
  });

  it('leaves every other operation exactly as it is', () => {
    const { searches, run } = rig();
    expect(run(catalogRequest('fetchRanobes'))).toEqual([emptyCatalog]);
    expect(searches).toHaveLength(0);
  });
});
