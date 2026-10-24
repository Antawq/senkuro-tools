import { describe, expect, it } from 'vitest';

import { catalogKindOf } from '../utils/catalog/catalog-results';
import { sortOrderOf, sortRows } from '../utils/catalog/catalog-sort';

const manga = catalogKindOf('fetchMangas')!;
const anime = catalogKindOf('fetchAnimes')!;

const rowsOf = (...slugs: string[]) => slugs.map((slug) => ({ slug }));
const keysOf = (entries: Record<string, Record<string, unknown>>) => new Map(Object.entries(entries).map(([slug, keys]) => [slug, { slug, ...keys }]));
const slugsOf = (rows: { slug?: unknown }[]) => rows.map((row) => row.slug);

describe('sortOrderOf', () => {
  it('reads the field and the direction the page asks for, for each sort of the manga catalog', () => {
    for (const [field, key] of [
      ['SCORE', 'score'],
      ['VIEWS', 'views'],
      ['CHAPTERS', 'chapters'],
      ['CREATED_AT', 'createdAt'],
      ['LAST_CHAPTER_AT', 'lastChapterAt'],
    ]) {
      expect(sortOrderOf({ orderField: field, orderDirection: 'DESC' }, manga)).toEqual({ key, isDescending: true });
    }
  });

  it('reads the sorts of the anime catalog, which has episodes where the manga catalog has chapters', () => {
    expect(sortOrderOf({ orderField: 'EPISODES', orderDirection: 'ASC' }, anime)).toEqual({ key: 'episodes', isDescending: false });
    expect(sortOrderOf({ orderField: 'LAST_EPISODE_AT' }, anime)).toEqual({ key: 'lastEpisodeAt', isDescending: true });
    expect(sortOrderOf({ orderField: 'EPISODES' }, manga)).toBeNull();
  });

  it('takes a missing direction for the descending one, which is the catalog default', () => {
    expect(sortOrderOf({ orderField: 'SCORE' }, manga)?.isDescending).toBe(true);
  });

  it('gives nothing for the popularity sort, the API has no field for it, and nothing for a field it does not know', () => {
    for (const orderField of ['POPULARITY_SCORE', 'RATING', '', undefined, 5]) expect(sortOrderOf({ orderField }, manga)).toBeNull();
    expect(sortOrderOf(undefined, manga)).toBeNull();
  });
});

describe('sortRows', () => {
  const descending = { key: 'score', isDescending: true };
  const ascending = { key: 'score', isDescending: false };

  it('orders by the number, highest first for the descending order and lowest first for the other', () => {
    const keys = keysOf({ a: { score: 3 }, b: { score: 9 }, c: { score: 6 } });
    expect(slugsOf(sortRows(rowsOf('a', 'b', 'c'), keys, descending))).toEqual(['b', 'c', 'a']);
    expect(slugsOf(sortRows(rowsOf('a', 'b', 'c'), keys, ascending))).toEqual(['a', 'c', 'b']);
  });

  it('puts the rows with no value last in both directions', () => {
    const keys = keysOf({ a: { score: null }, b: { score: 9 }, c: { score: 6 } });
    expect(slugsOf(sortRows(rowsOf('a', 'b', 'c'), keys, descending))).toEqual(['b', 'c', 'a']);
    expect(slugsOf(sortRows(rowsOf('a', 'b', 'c'), keys, ascending))).toEqual(['c', 'b', 'a']);
  });

  it('puts the rows the lookup knows nothing about after the others, in the order the search gave them', () => {
    const keys = keysOf({ b: { score: 9 } });
    expect(slugsOf(sortRows(rowsOf('x', 'b', 'y'), keys, descending))).toEqual(['b', 'x', 'y']);
    expect(slugsOf(sortRows(rowsOf('x', 'b', 'y'), keys, ascending))).toEqual(['b', 'x', 'y']);
  });

  it('breaks a tie by the creation time, newest first for the descending order, as the server does', () => {
    const keys = keysOf({
      old: { score: 5, createdAt: '2020-01-01T00:00:00.000000' },
      recent: { score: 5, createdAt: '2022-01-01T00:00:00.000000' },
      other: { score: 7, createdAt: '2021-01-01T00:00:00.000000' },
    });
    expect(slugsOf(sortRows(rowsOf('old', 'recent', 'other'), keys, descending))).toEqual(['other', 'recent', 'old']);
    expect(slugsOf(sortRows(rowsOf('old', 'recent', 'other'), keys, ascending))).toEqual(['old', 'recent', 'other']);
  });

  it('compares creation times as times, whatever the length of the fraction of a second', () => {
    const keys = keysOf({
      shorter: { score: 5, createdAt: '2023-04-07T00:56:00.46069' },
      longer: { score: 5, createdAt: '2023-04-07T00:56:00.460694' },
      whole: { score: 5, createdAt: '2023-04-07T00:56:00' },
    });
    expect(slugsOf(sortRows(rowsOf('whole', 'shorter', 'longer'), keys, ascending))).toEqual(['whole', 'shorter', 'longer']);
  });

  it('sorts by the creation time itself, newest first', () => {
    const keys = keysOf({ a: { createdAt: '2020-01-01T00:00:00.000000' }, b: { createdAt: '2022-01-01T00:00:00.000000' } });
    expect(slugsOf(sortRows(rowsOf('a', 'b'), keys, { key: 'createdAt', isDescending: true }))).toEqual(['b', 'a']);
  });

  it('keeps the order of the search for rows that are equal in every key, and does not touch the rows it is given', () => {
    const rows = rowsOf('a', 'b', 'c');
    const keys = keysOf({ a: { score: 5 }, b: { score: 5 }, c: { score: 5 } });
    expect(slugsOf(sortRows(rows, keys, descending))).toEqual(['a', 'b', 'c']);
    expect(slugsOf(rows)).toEqual(['a', 'b', 'c']);
  });
});
