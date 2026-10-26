import { describe, expect, it } from 'vitest';

import { streamCatalogMatches, type MatchQuery } from '../utils/catalog/catalog-matches';
import { CATALOG_ROW_LIMIT, SEARCH_PAGE_ROWS, catalogKindOf } from '../utils/catalog/catalog-results';
import { searchRequestOf } from '../utils/catalog/catalog-filters';
import { sortOrderOf } from '../utils/catalog/catalog-sort';
import type { CatalogRow } from '../utils/catalog/catalog-row';
import type { QueryClient } from '../utils/shared/urql-client';
import { factsAnswer, promiseOf, searchPage, type Answer, type QueryCall } from './helpers/catalog-requests';

const manga = catalogKindOf('fetchMangas')!;

const rig = (pages: Record<string, Answer>, facts: Answer = { data: {} }) => {
  const calls: QueryCall[] = [];
  const client = {
    executeQuery: () => null,
    executeMutation: () => null,
    query: (document: string, variables: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ document, variables, options });
      if (document.includes('catalogRowFacts')) return promiseOf(facts);
      return promiseOf(pages[String(variables.after)] ?? { data: null });
    },
  } as unknown as QueryClient;
  const searches = () => calls.filter((call) => !call.document.includes('catalogRowFacts'));
  const factRequests = () => calls.filter((call) => call.document.includes('catalogRowFacts'));
  return { client, searches, factRequests };
};

const slugsOf = (rows: { slug?: unknown }[]) => rows.map((row) => row.slug);
const numbered = (from: number, count: number) => Array.from({ length: count }, (_, index) => `m${from + index}`);

const query = (text: string, order: MatchQuery['order'] = null, filters: MatchQuery['filters'] = []): MatchQuery => ({ text, order, filters });

const filtersOf = (variables: Record<string, unknown>): MatchQuery['filters'] => searchRequestOf({ search: 'x', ...variables }, manga)?.filters ?? [];

const collect = async (stream: AsyncGenerator<CatalogRow[]>): Promise<CatalogRow[][]> => {
  const emissions: CatalogRow[][] = [];
  for await (const rows of stream) emissions.push(rows);
  return emissions;
};

const loadCatalogMatches = async (...parameters: Parameters<typeof streamCatalogMatches>): Promise<CatalogRow[]> =>
  (await collect(streamCatalogMatches(...parameters))).at(-1) ?? [];

describe('streamCatalogMatches', () => {
  it('follows the cursor of the search to the last page and gives every row once, in the order of the search', async () => {
    const { client, searches } = rig({ null: searchPage(['a', 'b'], 5, '2'), '2': searchPage(['c', 'd'], 5, '4'), '4': searchPage(['e'], 5) });
    const rows = await loadCatalogMatches(client, manga, query('любовь'), undefined);
    expect(slugsOf(rows)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(searches().map((call) => call.variables.after)).toEqual([null, '2', '4']);
    expect(searches()[0]?.variables).toMatchObject({ query: 'любовь', type: 'MANGA', first: SEARCH_PAGE_ROWS });
  });

  it('stops at the limit however many rows the search has, and says so by asking for no further page', async () => {
    const pages: Record<string, Answer> = {
      null: searchPage(numbered(0, SEARCH_PAGE_ROWS), 1000, '100'),
      '100': searchPage(numbered(100, SEARCH_PAGE_ROWS), 1000, '200'),
      '200': searchPage(numbered(200, SEARCH_PAGE_ROWS), 1000, '300'),
      '300': searchPage(numbered(300, SEARCH_PAGE_ROWS), 1000, '400'),
    };
    const { client, searches } = rig(pages);
    const rows = await loadCatalogMatches(client, manga, query('любовь'), undefined);
    expect(rows).toHaveLength(CATALOG_ROW_LIMIT);
    expect(searches()).toHaveLength(CATALOG_ROW_LIMIT / SEARCH_PAGE_ROWS);
  });

  it('stops when the search says it has no more, and when a page comes back empty, however the cursor reads', async () => {
    const { client, searches } = rig({ null: searchPage(['a'], 9, '1'), '1': searchPage([], 9, '1') });
    expect(slugsOf(await loadCatalogMatches(client, manga, query('x'), undefined))).toEqual(['a']);
    expect(searches()).toHaveLength(2);
  });

  it('skips a row that has no slug', async () => {
    const answer = searchPage(['a', 'b']);
    (answer.data as { search: { edges: { node: Record<string, unknown> }[] } }).search.edges[0]!.node.slug = undefined;
    const { client } = rig({ null: answer });
    expect(slugsOf(await loadCatalogMatches(client, manga, query('x'), undefined))).toEqual(['b']);
  });

  it('gives nothing when the first page fails or is not a search answer', async () => {
    for (const answer of [{ error: new Error('boom') }, { data: null }, { data: { search: null } }, {}]) {
      const { client } = rig({ null: answer });
      expect(await loadCatalogMatches(client, manga, query('x'), undefined)).toEqual([]);
    }
  });

  it('keeps every request on the cache and hands on what the page asked with', async () => {
    const { client, searches } = rig({ null: searchPage(['a']) });
    await loadCatalogMatches(client, manga, query('x'), { requestPolicy: 'cache-and-network', context: 'page' });
    expect(searches()[0]?.options).toEqual({ requestPolicy: 'cache-first', context: 'page' });
  });

  it('gives the rows after every page when there is no sort to make, each time with all the rows so far', async () => {
    const { client } = rig({ null: searchPage(['a', 'b'], 5, '2'), '2': searchPage(['c', 'd'], 5, '4'), '4': searchPage(['e'], 5) });
    const emissions = await collect(streamCatalogMatches(client, manga, query('x'), undefined));
    expect(emissions.map(slugsOf)).toEqual([
      ['a', 'b'],
      ['a', 'b', 'c', 'd'],
      ['a', 'b', 'c', 'd', 'e'],
    ]);
  });

  it('gives an empty list once, so the page hears that there is nothing, when the search finds nothing', async () => {
    const { client } = rig({ null: searchPage([]) });
    expect(await collect(streamCatalogMatches(client, manga, query('x'), undefined))).toEqual([[]]);
    expect(await collect(streamCatalogMatches(rig({ null: { error: new Error('boom') } }).client, manga, query('x'), undefined))).toEqual([[]]);
  });

  it('gives the rows once, after the last page and the values, when there is a sort to make', async () => {
    const { client } = rig(
      { null: searchPage(['a', 'b'], 4, '2'), '2': searchPage(['c', 'd'], 4) },
      factsAnswer({ a: { views: 1 }, b: { views: 4 }, c: { views: 3 }, d: { views: 2 } })
    );
    const order = sortOrderOf({ orderField: 'VIEWS', orderDirection: 'DESC' }, manga)!;
    const emissions = await collect(streamCatalogMatches(client, manga, query('x', order), undefined));
    expect(emissions.map(slugsOf)).toEqual([['b', 'c', 'd', 'a']]);
  });

  describe('with a sort', () => {
    const order = sortOrderOf({ orderField: 'VIEWS', orderDirection: 'DESC' }, manga)!;

    it('asks for the values of all rows in one request, filling all slots with the slugs and the last one repeated', async () => {
      const { client, factRequests } = rig({ null: searchPage(['a', 'b', 'c']) }, factsAnswer({ a: { views: 1 }, b: { views: 3 }, c: { views: 2 } }));
      const rows = await loadCatalogMatches(client, manga, query('x', order), undefined);
      expect(slugsOf(rows)).toEqual(['b', 'c', 'a']);
      expect(factRequests()).toHaveLength(1);
      const variables = factRequests()[0]!.variables;
      expect(Object.keys(variables)).toHaveLength(CATALOG_ROW_LIMIT);
      expect([variables.s0, variables.s1, variables.s2, variables.s3, variables[`s${CATALOG_ROW_LIMIT - 1}`]]).toEqual(['a', 'b', 'c', 'c', 'c']);
      expect(factRequests()[0]?.document).toContain(`$s${CATALOG_ROW_LIMIT - 1}: String!`);
    });

    it('asks for no values when there is no sort to make', async () => {
      const { client, factRequests } = rig({ null: searchPage(['a', 'b']) });
      await loadCatalogMatches(client, manga, query('x'), undefined);
      expect(factRequests()).toHaveLength(0);
    });

    it('asks for no values when the search found nothing', async () => {
      const { client, factRequests } = rig({ null: searchPage([]) });
      expect(await loadCatalogMatches(client, manga, query('x', order), undefined)).toEqual([]);
      expect(factRequests()).toHaveLength(0);
    });

    it('keeps the order of the search when the values cannot be had', async () => {
      const { client } = rig({ null: searchPage(['a', 'b']) }, { error: new Error('boom') });
      expect(slugsOf(await loadCatalogMatches(client, manga, query('x', order), undefined))).toEqual(['a', 'b']);
    });
  });

  describe('with filters', () => {
    const labels = (...slugs: string[]) => slugs.map((slug) => ({ slug }));
    const facts = factsAnswer({
      a: { labels: labels('romance'), status: 'FINISHED', views: 1 },
      b: { labels: labels('romance', 'drama'), status: 'ONGOING', views: 4 },
      c: { labels: labels('drama'), status: 'FINISHED', views: 3 },
      d: { labels: [], status: 'FINISHED', views: 2 },
    });
    const pages = { null: searchPage(['a', 'b', 'c', 'd']) };
    const romance = filtersOf({ label: { include: ['romance'], exclude: [] } });

    it('gives the rows that pass the filters, in the order of the search, once, after the values have come', async () => {
      const { client } = rig(pages, facts);
      const emissions = await collect(streamCatalogMatches(client, manga, query('x', null, romance), undefined));
      expect(emissions.map(slugsOf)).toEqual([['a', 'b']]);
    });

    it('asks for the values of all rows in one request, the same one a sort asks, and for nothing when no filter is set', async () => {
      const filtered = rig(pages, facts);
      await loadCatalogMatches(filtered.client, manga, query('x', null, romance), undefined);
      expect(filtered.factRequests()).toHaveLength(1);
      expect(filtered.factRequests()[0]?.options).toMatchObject({ requestPolicy: 'cache-first' });
      const plain = rig(pages, facts);
      await loadCatalogMatches(plain.client, manga, query('x'), undefined);
      expect(plain.factRequests()).toHaveLength(0);
    });

    it('sorts the rows that pass, with the same values', async () => {
      const { client, factRequests } = rig(pages, facts);
      const order = sortOrderOf({ orderField: 'VIEWS', orderDirection: 'DESC' }, manga)!;
      const rows = await loadCatalogMatches(client, manga, query('x', order, filtersOf({ status: { include: ['FINISHED'], exclude: [] } })), undefined);
      expect(slugsOf(rows)).toEqual(['c', 'd', 'a']);
      expect(factRequests()).toHaveLength(1);
    });

    it('applies all the filters together', async () => {
      const { client } = rig(pages, facts);
      const both = filtersOf({ label: { include: ['romance'], exclude: [] }, status: { include: ['FINISHED'], exclude: [] } });
      expect(slugsOf(await loadCatalogMatches(client, manga, query('x', null, both), undefined))).toEqual(['a']);
    });

    it('gives an empty list, once, when no row passes, so the page hears that there is nothing', async () => {
      const { client } = rig(pages, facts);
      const none = filtersOf({ label: { include: ['romance', 'horror'], exclude: [] } });
      expect(await collect(streamCatalogMatches(client, manga, query('x', null, none), undefined))).toEqual([[]]);
    });

    it('drops a row the lookup knows nothing about, and every row when the lookup fails, since nothing can be checked', async () => {
      const partial = rig(pages, factsAnswer({ a: { labels: labels('romance') } }));
      expect(slugsOf(await loadCatalogMatches(partial.client, manga, query('x', null, romance), undefined))).toEqual(['a']);
      const failing = rig(pages, { error: new Error('boom') });
      expect(await loadCatalogMatches(failing.client, manga, query('x', null, romance), undefined)).toEqual([]);
    });

    it('asks for nothing when the search finds nothing', async () => {
      const { client, factRequests } = rig({ null: searchPage([]) }, facts);
      expect(await loadCatalogMatches(client, manga, query('x', null, romance), undefined)).toEqual([]);
      expect(factRequests()).toHaveLength(0);
    });
  });
});
