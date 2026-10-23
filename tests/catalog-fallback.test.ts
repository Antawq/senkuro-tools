import { describe, expect, it } from 'vitest';

import { make, pipe, subscribe, type Source } from 'wonka';

import { CATALOG_SEARCH_PAGE_SIZE, installCatalogFallback } from '../utils/catalog/catalog-fallback';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';
import { firstOf, request, searchDocument } from './helpers/search-requests';

interface Answer {
  data?: unknown;
  error?: unknown;
  stale?: boolean;
  hasNext?: boolean;
}

const NO_FILTERS = { after: null, status: { include: [], exclude: [] }, releasedOn: {}, orderField: 'POPULARITY_SCORE', orderDirection: 'DESC' };

const catalogRequest = (operation: string, variables: Record<string, unknown> = {}): QueryRequest => ({
  key: 99,
  variables: { ...NO_FILTERS, search: 'НАРУТО', ...variables },
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: operation } }] },
});

const sourceOf = (answers: Answer[]): Source<Answer> =>
  make<Answer>((observer) => {
    answers.forEach((answer) => observer.next(answer));
    observer.complete();
    return () => undefined;
  });

const emptyCatalog: Answer = { data: { mangas: { edges: [] } } };

const searchAnswer = (...slugs: string[]): Answer => ({
  data: {
    search: {
      edges: slugs.map((slug) => ({
        node: { id: slug, slug, originalName: slug, titles: [], mangaType: 'MANGA', mangaStatus: 'FINISHED', mangaRating: 'ALL', score: 1, cover: null },
      })),
    },
  },
});

const rig = (catalogAnswers: Answer[] = [emptyCatalog], searchAnswers: Answer[] = [searchAnswer('naruto', 'boruto')]) => {
  const searches: { document: unknown; variables: Record<string, unknown>; options: unknown }[] = [];
  const client = {
    executeQuery: () => sourceOf(catalogAnswers),
    executeMutation: () => null,
    query: (document: unknown, variables: Record<string, unknown>, options: unknown) => {
      searches.push({ document, variables, options });
      return sourceOf(searchAnswers);
    },
  } as unknown as QueryClient;
  installCatalogFallback(client);
  const run = (asked: QueryRequest): Answer[] => {
    const seen: Answer[] = [];
    pipe(
      client.executeQuery(asked) as Source<Answer>,
      subscribe((answer) => seen.push(answer))
    );
    return seen;
  };
  const sawSearch = () => void client.executeQuery(request('search'));
  return { client, searches, run, sawSearch };
};

const rowsOf = (answer: Answer | undefined, root = 'mangas') =>
  (answer?.data as Record<string, { edges: { node: { slug: string; status: string } }[] }>)[root]?.edges ?? [];

describe('installCatalogFallback', () => {
  it('asks the search that finds Russian for the text, many rows at a time, when the catalog finds nothing', () => {
    const { searches, run, sawSearch } = rig();
    sawSearch();
    run(catalogRequest('fetchMangas'));
    expect(searches).toHaveLength(1);
    expect(searches[0]?.variables).toEqual({ query: 'наруто', type: 'MANGA' });
    expect(firstOf({ query: searches[0]?.document } as QueryRequest)).toEqual([String(CATALOG_SEARCH_PAGE_SIZE), '5']);
  });

  it('gives the page the rows of the search in the shape of its own answer', () => {
    const { run, sawSearch } = rig();
    sawSearch();
    const seen = run(catalogRequest('fetchMangas'));
    expect(seen).toHaveLength(1);
    expect(rowsOf(seen[0]).map((edge) => edge.node.slug)).toEqual(['naruto', 'boruto']);
    expect(rowsOf(seen[0])[0]?.node.status).toBe('FINISHED');
    expect(seen[0]?.error).toBeUndefined();
  });

  it('does the same for the anime catalog, with the anime search', () => {
    const animeSearch = { data: { search: { edges: [{ node: { id: '1', slug: 'naruto', originalName: 'Naruto', titles: [], animeStatus: 'FINISHED' } }] } } };
    const { client, searches, run } = rig([{ data: { animes: { edges: [] } } }], [animeSearch]);
    void client.executeQuery({ ...request('search'), variables: { query: 'x', type: 'ANIME' } });
    const seen = run(catalogRequest('fetchAnimes'));
    expect(searches[0]?.variables.type).toBe('ANIME');
    expect(rowsOf(seen[0], 'animes')).toHaveLength(1);
  });

  it('answers when the catalog answers with an error too', () => {
    const { run, sawSearch } = rig([{ error: new Error('boom') }]);
    sawSearch();
    const seen = run(catalogRequest('fetchMangas'));
    expect(rowsOf(seen[0])).toHaveLength(2);
    expect(seen[0]?.error).toBeUndefined();
  });

  it('leaves the catalog answer alone when it has rows', () => {
    const own: Answer = { data: { mangas: { edges: [{ node: { slug: 'x' } }] } } };
    const { searches, run, sawSearch } = rig([own]);
    sawSearch();
    expect(run(catalogRequest('fetchMangas'))).toEqual([own]);
    expect(searches).toHaveLength(0);
  });

  it('does not take a cached answer for the last word, and waits for the settled one', () => {
    const { searches, run, sawSearch } = rig([{ ...emptyCatalog, stale: true }, { data: { mangas: { edges: [{ node: { slug: 'x' } }] } } }]);
    sawSearch();
    const seen = run(catalogRequest('fetchMangas'));
    expect(searches).toHaveLength(0);
    expect(seen).toHaveLength(2);
  });

  it('leaves a catalog with another filter, another page or no text as it is', () => {
    const { searches, run, sawSearch } = rig();
    sawSearch();
    for (const variables of [{ status: { include: ['ONGOING'], exclude: [] } }, { after: 'cursor' }, { search: '' }, { search: undefined }]) {
      expect(run(catalogRequest('fetchMangas', variables))).toEqual([emptyCatalog]);
    }
    expect(searches).toHaveLength(0);
  });

  it('leaves the catalog alone until the page has made a search of its own, which holds the search to ask for', () => {
    const { searches, run } = rig();
    expect(run(catalogRequest('fetchMangas'))).toEqual([emptyCatalog]);
    expect(searches).toHaveLength(0);
  });

  it('only uses a search of the kind the catalog is about', () => {
    const { client, searches, run } = rig();
    void client.executeQuery({ ...request('search'), variables: { query: 'x', type: 'ANIME' } });
    expect(run(catalogRequest('fetchMangas'))).toEqual([emptyCatalog]);
    expect(searches).toHaveLength(0);
  });

  it('gives the catalog answer back when the search has nothing or fails', () => {
    for (const searchAnswers of [[searchAnswer()], [{ error: new Error('boom') }], [{ data: null }]]) {
      const { run, sawSearch } = rig([emptyCatalog], searchAnswers);
      sawSearch();
      expect(run(catalogRequest('fetchMangas'))).toEqual([emptyCatalog]);
    }
  });

  it('leaves every other operation exactly as it is', () => {
    const { searches, run, sawSearch } = rig();
    sawSearch();
    expect(run(catalogRequest('fetchRanobes'))).toEqual([emptyCatalog]);
    expect(searches).toHaveLength(0);
  });

  it('widens a document once and reuses the copy, so the client does not print and hash a new one each time', () => {
    const { searches, run, sawSearch } = rig();
    sawSearch();
    run(catalogRequest('fetchMangas'));
    run(catalogRequest('fetchMangas', { search: 'БЛИЧ' }));
    expect(searches[0]?.document).toBe(searches[1]?.document);
    expect(searches[1]?.variables).toEqual({ query: 'блич', type: 'MANGA' });
  });

  it('does not ask for fewer rows than the search was already asked for', () => {
    const { client, searches, run } = rig();
    void client.executeQuery({ ...request('search', searchDocument('100')), variables: { query: 'x', type: 'MANGA' } });
    run(catalogRequest('fetchMangas'));
    expect(firstOf({ query: searches[0]?.document } as QueryRequest)).toEqual(['100', '5']);
  });
});
