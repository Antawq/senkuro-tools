import { describe, expect, it } from 'vitest';

import { rowPasses, searchRequestOf } from '../utils/catalog/catalog-filters';
import { catalogKindOf } from '../utils/catalog/catalog-results';

const manga = catalogKindOf('fetchMangas')!;
const anime = catalogKindOf('fetchAnimes')!;

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

const filtersOf = (variables: Record<string, unknown>) => {
  const request = searchRequestOf({ ...NO_FILTERS, search: 'x', ...variables }, manga);
  if (!request) throw new Error('the request was not taken');
  return request.filters;
};

const passes = (facts: Record<string, unknown> | undefined, variables: Record<string, unknown>): boolean => rowPasses(facts, filtersOf(variables));

describe('searchRequestOf', () => {
  it('gives the text with no filters when the search is the only thing asked for, whatever the order', () => {
    expect(searchRequestOf({ ...NO_FILTERS, search: 'НАРУТО' }, manga)).toEqual({ text: 'НАРУТО', filters: [] });
    expect(searchRequestOf({ ...NO_FILTERS, orderField: 'SCORE', orderDirection: 'ASC', search: ' one piece ' }, manga)).toEqual({
      text: 'one piece',
      filters: [],
    });
  });

  it('gives nothing without a text to search', () => {
    for (const search of [undefined, null, '', '   ', 5, ['a']]) expect(searchRequestOf({ ...NO_FILTERS, search }, manga)).toBeNull();
    expect(searchRequestOf(undefined, manga)).toBeNull();
  });

  it('gives nothing for a later page, which the search would only repeat', () => {
    expect(searchRequestOf({ ...NO_FILTERS, after: 'cursor', search: 'x' }, manga)).toBeNull();
  });

  it('gives a condition for each filter that is set and none for the ones that are empty', () => {
    const request = searchRequestOf({ ...NO_FILTERS, search: 'x', status: { include: ['ONGOING'], exclude: [] }, chapters: { start: 20, end: 100 } }, manga);
    expect(request?.filters).toHaveLength(2);
    expect(searchRequestOf({ ...NO_FILTERS, search: 'x', releasedOn: { start: null, end: null }, type: {} }, manga)?.filters).toEqual([]);
  });

  it('takes the filters of the catalog it is asked for, so episodes belong to the anime catalog and chapters to the manga catalog', () => {
    expect(searchRequestOf({ search: 'x', episodes: { start: 1 } }, anime)?.filters).toHaveLength(1);
    expect(searchRequestOf({ search: 'x', chapters: { start: 1 } }, anime)).toBeNull();
    expect(searchRequestOf({ search: 'x', episodes: { start: 1 } }, manga)).toBeNull();
  });

  it('gives nothing when a filter it cannot apply is set, so that catalog stays as the site answers it', () => {
    for (const variables of [
      { character: { include: ['ID'], exclude: [] } },
      { staff: { include: ['ID'], exclude: [] } },
      { publisher: { include: ['ID'], exclude: [] } },
      { studio: { include: ['ID'], exclude: [] } },
      { season: { include: ['WINTER'], exclude: [] } },
      { bookmarkCollections: { include: ['ID'], exclude: [] } },
      { somethingNew: { include: ['x'] } },
    ]) {
      expect(searchRequestOf({ ...NO_FILTERS, search: 'x', ...variables }, manga)).toBeNull();
    }
  });

  it('gives nothing when a filter has a shape it does not know', () => {
    for (const variables of [
      { status: { include: 'ONGOING' } },
      { status: { include: [3] } },
      { status: { include: ['ONGOING'], mode: 'ALL' } },
      { status: 'ONGOING' },
      { label: { include: ['romance'], mode: 'SOME' } },
      { chapters: { start: 'many' } },
      { chapters: { start: true } },
      { releasedOn: { start: '2020' } },
      { releasedOn: { start: '2020-01-01', end: 'later' } },
    ]) {
      expect(searchRequestOf({ ...NO_FILTERS, search: 'x', ...variables }, manga)).toBeNull();
    }
  });

  it('reads the numbers the page sends as text too, because the number inputs of the site do', () => {
    const request = searchRequestOf({ ...NO_FILTERS, search: 'x', chapters: { start: 15, end: '40' } }, manga);
    expect(rowPasses({ chapters: 40 }, request?.filters ?? [])).toBe(true);
    expect(rowPasses({ chapters: 41 }, request?.filters ?? [])).toBe(false);
  });
});

describe('rowPasses with the rules of the server', () => {
  it('passes every row when there is no filter, even one the lookup knew nothing about', () => {
    expect(rowPasses(undefined, [])).toBe(true);
    expect(rowPasses({}, [])).toBe(true);
  });

  it('drops a row the lookup knew nothing about as soon as there is a filter, since it cannot be checked', () => {
    expect(passes(undefined, { status: { include: ['ONGOING'], exclude: [] } })).toBe(false);
  });

  it('takes a one-valued field that is in the include list, and not one that is outside it', () => {
    const variables = { type: { include: ['MANHWA', 'MANHUA'], exclude: [] } };
    expect(passes({ type: 'MANHWA' }, variables)).toBe(true);
    expect(passes({ type: 'MANGA' }, variables)).toBe(false);
  });

  it('takes a one-valued field that is not in the exclude list', () => {
    const variables = { status: { include: [], exclude: ['ONGOING', 'FINISHED'] } };
    expect(passes({ status: 'HIATUS' }, variables)).toBe(true);
    expect(passes({ status: 'ONGOING' }, variables)).toBe(false);
  });

  it('does not take a row with no value for the field when the filter excludes, as the server does not (a null is neither in nor out)', () => {
    expect(passes({ source: null }, { source: { include: [], exclude: ['GAME'] } })).toBe(false);
    expect(passes({ originCountry: null }, { originCountry: { include: [], exclude: ['KR'] } })).toBe(false);
    expect(passes({ source: 'ORIGINAL' }, { source: { include: [], exclude: ['GAME'] } })).toBe(true);
  });

  it('does not take a row with no value for the field when the filter includes', () => {
    expect(passes({ source: null }, { source: { include: ['GAME'], exclude: [] } })).toBe(false);
    expect(passes({}, { source: { include: ['GAME'], exclude: [] } })).toBe(false);
  });

  it('applies include and exclude of one field together', () => {
    const variables = { type: { include: ['MANGA', 'MANHWA'], exclude: ['MANGA'] } };
    expect(passes({ type: 'MANHWA' }, variables)).toBe(true);
    expect(passes({ type: 'MANGA' }, variables)).toBe(false);
  });

  it('wants all the formats of the include list, not just one of them', () => {
    const variables = { format: { include: ['WEB', 'IN_COLOR'], exclude: [] } };
    expect(passes({ formats: ['WEB', 'WEBTOON', 'IN_COLOR'] }, variables)).toBe(true);
    expect(passes({ formats: ['WEB'] }, variables)).toBe(false);
    expect(passes({ formats: [] }, variables)).toBe(false);
  });

  it('drops a row only when it has all the formats of the exclude list, so one of two excluded formats is not enough', () => {
    const variables = { format: { include: [], exclude: ['WEBTOON', 'DOUJINSHI'] } };
    expect(passes({ formats: ['WEBTOON'] }, variables)).toBe(true);
    expect(passes({ formats: ['WEBTOON', 'DOUJINSHI'] }, variables)).toBe(false);
    expect(passes({ formats: ['WEBTOON'] }, { format: { include: [], exclude: ['WEBTOON'] } })).toBe(false);
    expect(passes({ formats: [] }, variables)).toBe(true);
  });

  it('wants all the labels asked for unless the mode says any, which is how the site asks', () => {
    const labels = [{ slug: 'romance' }, { slug: 'drama' }];
    expect(passes({ labels }, { label: { include: ['romance', 'drama'], exclude: [] } })).toBe(true);
    expect(passes({ labels: [{ slug: 'romance' }] }, { label: { include: ['romance', 'drama'], exclude: [] } })).toBe(false);
    expect(passes({ labels: [{ slug: 'romance' }] }, { label: { include: ['romance', 'drama'], exclude: [], mode: 'ANY' } })).toBe(true);
    expect(passes({ labels: [{ slug: 'romance' }] }, { label: { include: ['romance', 'drama'], exclude: [], mode: 'ALL' } })).toBe(false);
  });

  it('drops a row that has any of the labels of the exclude list', () => {
    const variables = { label: { include: [], exclude: ['erotica', 'ecchi'] } };
    expect(passes({ labels: [{ slug: 'romance' }] }, variables)).toBe(true);
    expect(passes({ labels: [{ slug: 'romance' }, { slug: 'ecchi' }] }, variables)).toBe(false);
    expect(passes({ labels: [] }, variables)).toBe(true);
    expect(passes({ labels: [{ slug: 'shoujo' }] }, { label: { include: ['shoujo'], exclude: ['romance'] } })).toBe(true);
    expect(passes({ labels: [{ slug: 'shoujo' }, { slug: 'romance' }] }, { label: { include: ['shoujo'], exclude: ['romance'] } })).toBe(false);
  });

  it('keeps the numbers inside the range, ends included, and a half open range when one end is missing', () => {
    expect(passes({ chapters: 20 }, { chapters: { start: 20, end: 100 } })).toBe(true);
    expect(passes({ chapters: 100 }, { chapters: { start: 20, end: 100 } })).toBe(true);
    expect(passes({ chapters: 19 }, { chapters: { start: 20, end: 100 } })).toBe(false);
    expect(passes({ chapters: 101 }, { chapters: { start: 20, end: 100 } })).toBe(false);
    expect(passes({ chapters: 500 }, { chapters: { start: 20 } })).toBe(true);
    expect(passes({ chapters: 3 }, { chapters: { end: 5 } })).toBe(true);
    expect(passes({ chapters: 6 }, { chapters: { end: 5 } })).toBe(false);
  });

  it('keeps the dates inside the range, ends included, and drops a row with no date when there is a range', () => {
    const variables = { releasedOn: { start: '2026-07-01', end: '2026-09-30' } };
    expect(passes({ releasedOn: '2026-07-01' }, variables)).toBe(true);
    expect(passes({ releasedOn: '2026-09-30' }, variables)).toBe(true);
    expect(passes({ releasedOn: '2026-06-30' }, variables)).toBe(false);
    expect(passes({ releasedOn: '2026-10-01' }, variables)).toBe(false);
    expect(passes({ releasedOn: null }, variables)).toBe(false);
    expect(passes({ completedOn: '2024-05-05' }, { completedOn: { start: '2020-01-01' } })).toBe(true);
  });

  it('needs every filter to pass, one after the other', () => {
    const variables = { status: { include: ['FINISHED'], exclude: [] }, rating: { include: ['GENERAL'], exclude: [] }, chapters: { start: 10 } };
    expect(passes({ status: 'FINISHED', rating: 'GENERAL', chapters: 12 }, variables)).toBe(true);
    expect(passes({ status: 'FINISHED', rating: 'GENERAL', chapters: 9 }, variables)).toBe(false);
    expect(passes({ status: 'ONGOING', rating: 'GENERAL', chapters: 12 }, variables)).toBe(false);
  });

  it('reads the episodes of an anime and the translation status of either catalog', () => {
    const request = searchRequestOf({ search: 'x', episodes: { start: 12, end: 26 }, translitionStatus: { include: ['FINISHED'], exclude: [] } }, anime);
    expect(rowPasses({ episodes: 24, translitionStatus: 'FINISHED' }, request?.filters ?? [])).toBe(true);
    expect(rowPasses({ episodes: 24, translitionStatus: 'FROZEN' }, request?.filters ?? [])).toBe(false);
    expect(rowPasses({ episodes: 30, translitionStatus: 'FINISHED' }, request?.filters ?? [])).toBe(false);
  });
});
