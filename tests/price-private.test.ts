import { describe, expect, it } from 'vitest';

import type { Variables } from '../utils/inventory/list-families';
import { createPrivateCursor, hasPrivateCursor, readCursor, realVariablesOf, variableNamesOf, viewKeyOf } from '../utils/inventory/price-private';

const grid = (extra: Variables = {}): Variables => ({
  userId: 'USER:1',
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
  rank: { include: [] },
  modifier: { include: [0] },
  after: null,
  ...extra,
});

const pickerOf = (variables: Variables): Variables =>
  Object.fromEntries(Object.entries(variables).filter(([name]) => name !== 'orderField' && name !== 'orderDirection'));

describe('the private cursor', () => {
  it('carries the version of the view and the place in its list, and reads back', () => {
    expect(readCursor(createPrivateCursor(3, 40))).toEqual({ version: 3, offset: 40 });
    expect(hasPrivateCursor(createPrivateCursor(3, 40))).toBe(true);
  });

  it('is not read from a cursor of the server, a cut one or one with extra parts', () => {
    for (const after of [
      null,
      undefined,
      '',
      'UgECAA_YJe18',
      5,
      'senkutools:price:',
      'senkutools:price:1',
      'senkutools:price:a:1',
      'senkutools:price:1:b',
      'senkutools:price:1:2:3',
      'senkutools:price:-1:2',
    ]) {
      expect(readCursor(after)).toBeNull();
    }
    expect(hasPrivateCursor('UgECAA_YJe18')).toBe(false);
    expect(hasPrivateCursor('senkutools:price:1')).toBe(true);
  });
});

describe('viewKeyOf', () => {
  it('ignores the cursor and the direction in price order, and the order the names come in', () => {
    const reordered = { rank: { include: [] }, modifier: { include: [0] }, orderField: 'CREATED_AT', userId: 'USER:1', orderDirection: 'ASC', after: 'c9' };
    expect(viewKeyOf(reordered, 'price')).toBe(viewKeyOf(grid(), 'price'));
    expect(viewKeyOf(grid({ after: undefined }), 'price')).toBe(viewKeyOf(grid(), 'price'));
  });

  it('keeps the direction in the order of the site, since the other direction is another list of the server', () => {
    expect(viewKeyOf(grid({ orderDirection: 'ASC' }), 'site')).not.toBe(viewKeyOf(grid(), 'site'));
    expect(viewKeyOf(grid({ after: 'c9' }), 'site')).toBe(viewKeyOf(grid(), 'site'));
  });

  it('tells lists apart by user, field, filters and the names asked, so a picker of the same user is another list', () => {
    for (const sort of ['price', 'site'] as const) {
      const key = viewKeyOf(grid(), sort);
      expect(viewKeyOf(grid({ userId: 'USER:2' }), sort)).not.toBe(key);
      expect(viewKeyOf(grid({ orderField: 'RANK' }), sort)).not.toBe(key);
      expect(viewKeyOf(grid({ modifier: { include: [1] } }), sort)).not.toBe(key);
      expect(viewKeyOf(grid({ rank: { include: ['S'] } }), sort)).not.toBe(key);
      expect(viewKeyOf(grid({ animated: null }), sort)).not.toBe(key);
      expect(viewKeyOf(pickerOf(grid()), sort)).not.toBe(key);
    }
  });
});

describe('variableNamesOf', () => {
  it('names what is asked, without the cursor', () => {
    expect(variableNamesOf(grid())).toBe(variableNamesOf(grid({ after: 'c1', rank: { include: ['S'] } })));
    expect(variableNamesOf(grid({ after: undefined }))).toBe(variableNamesOf(grid()));
    expect(variableNamesOf(grid({ animated: null }))).not.toBe(variableNamesOf(grid()));
  });

  it('names the fields of a filter too, so the list of the deck builder and the one of a window are other kinds of list', () => {
    const deck = grid({ modifier: { exclude: [1] } });
    const window = grid({ modifier: { exclude: [] }, rank: { include: [], exclude: ['R'] } });
    expect(variableNamesOf(deck)).not.toBe(variableNamesOf(window));
    expect(variableNamesOf(deck)).not.toBe(variableNamesOf(grid()));
    expect(variableNamesOf(window)).toBe(variableNamesOf(grid({ modifier: { exclude: [1] }, rank: { include: ['S'], exclude: [] } })));
  });
});

describe('realVariablesOf', () => {
  it('drops a private cursor and touches nothing else', () => {
    expect(realVariablesOf(grid({ after: createPrivateCursor(2, 40) }))).toEqual(grid({ after: null }));
    const real = grid({ after: 'UgECAA_YJe18' });
    expect(realVariablesOf(real)).toBe(real);
  });
});
