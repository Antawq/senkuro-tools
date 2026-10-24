import { describe, expect, it } from 'vitest';

import {
  createListRecord,
  familyIdOf,
  isGridFamily,
  isNewestFirst,
  isPickerFamily,
  judge,
  linked,
  needsRefresh,
  pageIdOf,
  readRawPage,
  type PageRequest,
  type Variables,
} from '../utils/inventory/list-families';

const page = (variables: Variables): PageRequest => ({ document: 'doc', variables, options: {} });

const card = (rank: string, { modifier = 0, animated = false, explicit = false }: { modifier?: number; animated?: boolean; explicit?: boolean } = {}) => ({
  modifier,
  card: { rank, animated, explicit },
});

const splitPicker: Variables = {
  userId: 'USER:1',
  after: null,
  rank: { include: [], exclude: ['F'] },
  color: { include: [] },
  modifier: { exclude: [1] },
  animated: false,
  explicit: null,
};
const profileGrid: Variables = { userId: 'USER:1' };

const raw = (ids: string[], endCursor: string | null, hasNextPage = true) => ({
  data: {
    userCards: {
      pageInfo: { endCursor, hasNextPage },
      edges: ids.map((id) => ({ node: { modifier: 0, card: { id } } })),
    },
  },
});

describe('family and page ids', () => {
  it('ignores the cursor and key order when naming a family', () => {
    expect(familyIdOf({ b: 1, a: 2, after: 'x' })).toBe(familyIdOf({ a: 2, b: 1, after: null }));
    expect(familyIdOf({ a: 1 })).not.toBe(familyIdOf({ a: 2 }));
  });

  it('treats an absent, an undefined and a null cursor as the same first page', () => {
    expect(pageIdOf({ a: 1, after: undefined })).toBe(pageIdOf({ a: 1 }));
    expect(pageIdOf({ a: 1, after: null })).toBe(pageIdOf({ a: 1 }));
    expect(pageIdOf({ a: 1, after: 'c1' })).not.toBe(pageIdOf({ a: 1 }));
  });
});

describe('isNewestFirst', () => {
  it('accepts the default sort in every spelling', () => {
    expect(isNewestFirst({})).toBe(true);
    expect(isNewestFirst({ orderField: 'CREATED_AT', orderDirection: 'DESC' })).toBe(true);
    expect(isNewestFirst({ orderField: null, orderDirection: null })).toBe(true);
  });

  it('rejects any other sort', () => {
    expect(isNewestFirst({ orderField: 'RANK' })).toBe(false);
    expect(isNewestFirst({ orderDirection: 'ASC' })).toBe(false);
  });
});

describe('judge', () => {
  it('excludes a received F card from the split picker and keeps higher ranks', () => {
    expect(judge(splitPicker, card('F'))).toBe('exclude');
    expect(judge(splitPicker, card('C'))).toBe('match');
  });

  it('honours rank include as any-of and modifier include', () => {
    expect(judge({ rank: { include: ['S', 'A'] } }, card('B'))).toBe('exclude');
    expect(judge({ rank: { include: ['S', 'A'] } }, card('A'))).toBe('match');
    expect(judge({ modifier: { include: [1] } }, card('C'))).toBe('exclude');
  });

  it('keeps shards out where modifier 1 is excluded', () => {
    expect(judge(splitPicker, card('C', { modifier: 1 }))).toBe('exclude');
  });

  it('judges the animated and explicit flags of the card', () => {
    expect(judge({ animated: false }, card('C', { animated: true }))).toBe('exclude');
    expect(judge({ animated: true }, card('C'))).toBe('exclude');
    expect(judge({ explicit: false }, card('C', { explicit: true }))).toBe('exclude');
    expect(judge({ explicit: true }, card('C'))).toBe('exclude');
    expect(judge({ animated: null, explicit: null }, card('C'))).toBe('match');
  });

  it('treats null, missing and empty filters as no filter', () => {
    expect(judge({ rank: null, modifier: { include: [], exclude: [] }, color: { include: [] }, quantity: null }, card('F'))).toBe('match');
    expect(judge(profileGrid, card('F'))).toBe('match');
  });

  it('cannot judge filters the payload has no data for, nor an entry it cannot read', () => {
    expect(judge({ color: { include: ['RED'] } }, card('C'))).toBe('unknown');
    expect(judge({ wants: true }, card('C'))).toBe('unknown');
    expect(judge({ quantity: { min: 2 } }, card('C'))).toBe('unknown');
    expect(judge({}, {})).toBe('unknown');
    expect(judge({}, { card: {} })).toBe('unknown');
  });

  it('cannot judge a list that is not newest first, because the site inserts at the top', () => {
    expect(judge({ orderField: 'RANK' }, card('C'))).toBe('unknown');
  });
});

describe('needsRefresh', () => {
  const family = (filters: Variables) => ({ id: familyIdOf(filters), filters, pages: [] });

  it('refreshes a list that excludes at least one received card', () => {
    expect(needsRefresh(family(splitPicker), [card('F'), card('C')])).toBe(true);
  });

  it('leaves a list that accepts every received card to the site', () => {
    expect(needsRefresh(family(splitPicker), [card('C'), card('D')])).toBe(false);
    expect(needsRefresh(family(profileGrid), [card('F')])).toBe(false);
  });

  it('always refreshes a list the site cannot update, even when nothing was added', () => {
    expect(needsRefresh(family({ userId: 'USER:1', orderField: 'RANK' }), [])).toBe(true);
    expect(needsRefresh(family(profileGrid), [])).toBe(false);
  });

  it('refreshes when a received card cannot be judged', () => {
    expect(needsRefresh(family({ color: { include: ['RED'] } }), [card('C')])).toBe(true);
  });
});

describe('readRawPage', () => {
  it('reads the cursor, the next-page flag and the card ids', () => {
    const page = readRawPage(raw(['a', 'b'], 'c2'));
    expect(page?.endCursor).toBe('c2');
    expect(page?.hasNextPage).toBe(true);
    expect([...(page?.ids ?? [])]).toEqual(['a:0', 'b:0']);
  });

  it('returns null for an answer without the list', () => {
    expect(readRawPage({ errors: [{ message: 'no' }] })).toBeNull();
    expect(readRawPage(null)).toBeNull();
    expect(readRawPage({ data: { userCards: null } })).toBeNull();
  });

  it('copes with an empty page and a missing cursor', () => {
    const page = readRawPage({ data: { userCards: { pageInfo: {}, edges: [] } } });
    expect(page).toEqual({ endCursor: null, hasNextPage: false, ids: new Set() });
  });
});

describe('linked', () => {
  const current = readRawPage(raw(['a', 'b'], 'c2'));
  it('is linked when the next page starts after this page’s end cursor', () => {
    expect(linked(current!, 'c2', readRawPage(raw(['c', 'd'], 'c4'))!)).toBe(true);
  });

  it('is linked when the pages share a card, because the list then has no hole', () => {
    expect(linked(current!, 'old', readRawPage(raw(['b', 'c'], 'c4'))!)).toBe(true);
  });

  it('is linked when the next page is empty', () => {
    expect(linked(current!, 'old', readRawPage(raw([], null, false))!)).toBe(true);
  });

  it('is not linked when the cursor moved and nothing overlaps', () => {
    expect(linked(current!, 'old', readRawPage(raw(['c', 'd'], 'c4'))!)).toBe(false);
  });
});

describe('createListRecord', () => {
  it('groups pages into families by their filters and keeps scroll order', () => {
    const record = createListRecord();
    record.record(page({ ...splitPicker, after: null }));
    record.record(page({ ...splitPicker, after: 'c1' }));
    record.record(page({ ...profileGrid }));
    record.record(page({ ...splitPicker, after: 'c2' }));
    const [picker, profile] = record.families();
    expect(picker?.pages.map((p) => p.variables.after)).toEqual([null, 'c1', 'c2']);
    expect(picker?.filters).not.toHaveProperty('after');
    expect(profile?.pages).toHaveLength(1);
  });

  it('records a page once however many times it runs', () => {
    const record = createListRecord();
    record.record(page({ ...splitPicker, after: null }));
    record.record(page({ ...splitPicker, after: null }));
    record.record(page({ ...splitPicker, after: 'c1' }));
    record.record(page({ ...splitPicker, after: 'c1' }));
    expect(record.families()[0]?.pages).toHaveLength(2);
  });

  it('inserts filler pages right after their anchor', () => {
    const record = createListRecord();
    const first = page({ ...profileGrid });
    const second = page({ ...profileGrid, after: 'c1' });
    record.record(first);
    record.record(second);
    const [family] = record.families();
    record.insertAfter(family!, first, [page({ ...profileGrid, after: 'x1' }), page({ ...profileGrid, after: 'x2' })]);
    expect(family?.pages.map((p) => p.variables.after)).toEqual([undefined, 'x1', 'x2', 'c1']);
  });

  it('adds the first page when only later pages were seen, as when the page was loaded before the client was found', () => {
    const record = createListRecord();
    record.record({ document: 'doc', variables: { ...profileGrid, after: 'c1' }, options: { suspense: true } });
    record.record({ document: 'doc', variables: { ...profileGrid, after: 'c2' }, options: { suspense: true } });
    const [family] = record.families();
    expect(family?.pages.map((p) => p.variables.after)).toEqual([undefined, 'c1', 'c2']);
    expect(family?.pages[0]).toEqual({ document: 'doc', variables: profileGrid, options: { suspense: true } });
  });

  it('keeps a single first page whichever way it is spelled or whenever it is recorded', () => {
    const record = createListRecord();
    record.record(page({ ...splitPicker, after: 'c1' }));
    record.record(page({ ...splitPicker, after: null }));
    record.record(page({ ...splitPicker, after: undefined }));
    const [family] = record.families();
    expect(family?.pages).toHaveLength(2);
    expect(family?.pages.filter((p) => p.variables.after == null)).toHaveLength(1);
  });

  it('does not invent a first page for a list that already has one', () => {
    const record = createListRecord();
    record.record(page({ ...profileGrid }));
    record.record(page({ ...profileGrid, after: 'c1' }));
    expect(record.families()[0]?.pages).toHaveLength(2);
  });

  it('does not insert a page it already knows', () => {
    const record = createListRecord();
    const first = page({ ...profileGrid });
    record.record(first);
    const [family] = record.families();
    record.insertAfter(family!, first, [page({ ...profileGrid, after: 'x1' })]);
    record.insertAfter(family!, first, [page({ ...profileGrid, after: 'x1' })]);
    expect(family?.pages).toHaveLength(2);
  });
});

describe('the route of a family', () => {
  it('keeps the route of the latest request of the family', () => {
    const record = createListRecord();
    record.record(page(profileGrid), '/users/a/cards');
    record.record(page({ ...profileGrid, after: 'c1' }), '/users/b/cards');
    expect(record.families().map((family) => family.route)).toEqual(['/users/b/cards']);
  });

  it('has no route until a request names one', () => {
    const record = createListRecord();
    record.record(page(profileGrid));
    expect(record.families()[0]?.route).toBeUndefined();
    record.record(page({ ...profileGrid, after: 'c1' }), '/users/a/cards');
    record.record(page({ ...profileGrid, after: 'c2' }));
    expect(record.families()[0]?.route).toBe('/users/a/cards');
  });
});

describe('what a family is for', () => {
  const familyOf = (variables: Variables) => {
    const record = createListRecord();
    record.record(page(variables));
    return record.families()[0]!;
  };

  it('takes a list that includes modifiers for the grid of a profile', () => {
    const grid = familyOf({ userId: 'USER:1', modifier: { include: [0] }, orderField: 'CREATED_AT', orderDirection: 'DESC' });
    expect(isGridFamily(grid)).toBe(true);
    expect(isPickerFamily(grid)).toBe(false);
  });

  it('takes a list that excludes modifiers for a picker of a modal', () => {
    for (const variables of [{ userId: 'USER:1', modifier: { exclude: [] } }, splitPicker]) {
      const picker = familyOf(variables);
      expect(isPickerFamily(picker)).toBe(true);
      expect(isGridFamily(picker)).toBe(false);
    }
  });

  it('takes a list with no modifier variable for neither', () => {
    const other = familyOf(profileGrid);
    expect(isGridFamily(other)).toBe(false);
    expect(isPickerFamily(other)).toBe(false);
  });
});
