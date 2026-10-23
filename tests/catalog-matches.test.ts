import { describe, expect, it } from 'vitest';

import { streamCatalogMatches } from '../utils/catalog/catalog-matches';
import { CATALOG_ROW_LIMIT, SEARCH_PAGE_ROWS, catalogKindOf } from '../utils/catalog/catalog-results';
import { sortOrderOf } from '../utils/catalog/catalog-sort';
import type { QueryClient } from '../utils/shared/urql-client';
import { promiseOf, searchPage, sortKeysAnswer, type Answer, type QueryCall } from './helpers/catalog-requests';

const manga = catalogKindOf('fetchMangas')!;

const rig = (pages: Record<string, Answer>, sortKeys: Answer = { data: {} }) => {
  const calls: QueryCall[] = [];
  const client = {
    executeQuery: () => null,
    executeMutation: () => null,
    query: (document: string, variables: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ document, variables, options });
      if (document.includes('catalogSortKeys')) return promiseOf(sortKeys);
      return promiseOf(pages[String(variables.after)] ?? { data: null });
    },
  } as unknown as QueryClient;
  const searches = () => calls.filter((call) => !call.document.includes('catalogSortKeys'));
  const sortRequests = () => calls.filter((call) => call.document.includes('catalogSortKeys'));
  return { client, searches, sortRequests };
};

const slugsOf = (rows: { slug?: unknown }[]) => rows.map((row) => row.slug);
const numbered = (from: number, count: number) => Array.from({ length: count }, (_, index) => `m${from + index}`);

type Row = Record<string, unknown>;

const collect = async (stream: AsyncGenerator<Row[]>): Promise<Row[][]> => {
  const emissions: Row[][] = [];
  for await (const rows of stream) emissions.push(rows);
  return emissions;
};

const loadCatalogMatches = async (...parameters: Parameters<typeof streamCatalogMatches>): Promise<Row[]> =>
  (await collect(streamCatalogMatches(...parameters))).at(-1) ?? [];

describe('streamCatalogMatches', () => {
  it('follows the cursor of the search to the last page and gives every row once, in the order of the search', async () => {
    const { client, searches } = rig({ null: searchPage(['a', 'b'], 5, '2'), '2': searchPage(['c', 'd'], 5, '4'), '4': searchPage(['e'], 5) });
    const rows = await loadCatalogMatches(client, manga, 'любовь', null, undefined);
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
    const rows = await loadCatalogMatches(client, manga, 'любовь', null, undefined);
    expect(rows).toHaveLength(CATALOG_ROW_LIMIT);
    expect(searches()).toHaveLength(CATALOG_ROW_LIMIT / SEARCH_PAGE_ROWS);
  });

  it('stops when the search says it has no more, and when a page comes back empty, however the cursor reads', async () => {
    const { client, searches } = rig({ null: searchPage(['a'], 9, '1'), '1': searchPage([], 9, '1') });
    expect(slugsOf(await loadCatalogMatches(client, manga, 'x', null, undefined))).toEqual(['a']);
    expect(searches()).toHaveLength(2);
  });

  it('skips a row that has no slug', async () => {
    const answer = searchPage(['a', 'b']);
    (answer.data as { search: { edges: { node: Record<string, unknown> }[] } }).search.edges[0]!.node.slug = undefined;
    const { client } = rig({ null: answer });
    expect(slugsOf(await loadCatalogMatches(client, manga, 'x', null, undefined))).toEqual(['b']);
  });

  it('gives nothing when the first page fails or is not a search answer', async () => {
    for (const answer of [{ error: new Error('boom') }, { data: null }, { data: { search: null } }, {}]) {
      const { client } = rig({ null: answer });
      expect(await loadCatalogMatches(client, manga, 'x', null, undefined)).toEqual([]);
    }
  });

  it('keeps every request on the cache and hands on what the page asked with', async () => {
    const { client, searches } = rig({ null: searchPage(['a']) });
    await loadCatalogMatches(client, manga, 'x', null, { requestPolicy: 'cache-and-network', context: 'page' });
    expect(searches()[0]?.options).toEqual({ requestPolicy: 'cache-first', context: 'page' });
  });

  it('gives the rows after every page when there is no sort to make, each time with all the rows so far', async () => {
    const { client } = rig({ null: searchPage(['a', 'b'], 5, '2'), '2': searchPage(['c', 'd'], 5, '4'), '4': searchPage(['e'], 5) });
    const emissions = await collect(streamCatalogMatches(client, manga, 'x', null, undefined));
    expect(emissions.map(slugsOf)).toEqual([
      ['a', 'b'],
      ['a', 'b', 'c', 'd'],
      ['a', 'b', 'c', 'd', 'e'],
    ]);
  });

  it('gives an empty list once, so the page hears that there is nothing, when the search finds nothing', async () => {
    const { client } = rig({ null: searchPage([]) });
    expect(await collect(streamCatalogMatches(client, manga, 'x', null, undefined))).toEqual([[]]);
    expect(await collect(streamCatalogMatches(rig({ null: { error: new Error('boom') } }).client, manga, 'x', null, undefined))).toEqual([[]]);
  });

  it('gives the rows once, after the last page and the values, when there is a sort to make', async () => {
    const { client } = rig(
      { null: searchPage(['a', 'b'], 4, '2'), '2': searchPage(['c', 'd'], 4) },
      sortKeysAnswer({ a: { views: 1 }, b: { views: 4 }, c: { views: 3 }, d: { views: 2 } })
    );
    const order = sortOrderOf({ orderField: 'VIEWS', orderDirection: 'DESC' }, manga)!;
    const emissions = await collect(streamCatalogMatches(client, manga, 'x', order, undefined));
    expect(emissions.map(slugsOf)).toEqual([['b', 'c', 'd', 'a']]);
  });

  describe('with a sort', () => {
    const order = sortOrderOf({ orderField: 'VIEWS', orderDirection: 'DESC' }, manga)!;

    it('asks for the values of all rows in one request, filling all slots with the slugs and the last one repeated', async () => {
      const { client, sortRequests } = rig({ null: searchPage(['a', 'b', 'c']) }, sortKeysAnswer({ a: { views: 1 }, b: { views: 3 }, c: { views: 2 } }));
      const rows = await loadCatalogMatches(client, manga, 'x', order, undefined);
      expect(slugsOf(rows)).toEqual(['b', 'c', 'a']);
      expect(sortRequests()).toHaveLength(1);
      const variables = sortRequests()[0]!.variables;
      expect(Object.keys(variables)).toHaveLength(CATALOG_ROW_LIMIT);
      expect([variables.s0, variables.s1, variables.s2, variables.s3, variables[`s${CATALOG_ROW_LIMIT - 1}`]]).toEqual(['a', 'b', 'c', 'c', 'c']);
      expect(sortRequests()[0]?.document).toContain(`$s${CATALOG_ROW_LIMIT - 1}: String!`);
    });

    it('asks for no values when there is no sort to make', async () => {
      const { client, sortRequests } = rig({ null: searchPage(['a', 'b']) });
      await loadCatalogMatches(client, manga, 'x', null, undefined);
      expect(sortRequests()).toHaveLength(0);
    });

    it('asks for no values when the search found nothing', async () => {
      const { client, sortRequests } = rig({ null: searchPage([]) });
      expect(await loadCatalogMatches(client, manga, 'x', order, undefined)).toEqual([]);
      expect(sortRequests()).toHaveLength(0);
    });

    it('keeps the order of the search when the values cannot be had', async () => {
      const { client } = rig({ null: searchPage(['a', 'b']) }, { error: new Error('boom') });
      expect(slugsOf(await loadCatalogMatches(client, manga, 'x', order, undefined))).toEqual(['a', 'b']);
    });
  });
});
