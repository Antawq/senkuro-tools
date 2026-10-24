import { describe, expect, it } from 'vitest';

import type { Variables } from '../utils/inventory/list-families';
import {
  cursorOf,
  hasPrivateCursor,
  isPrivateField,
  isPrivateVariables,
  mentionsPrivateField,
  privateFieldOf,
  privateVariablesOf,
  readCursor,
  realVariablesOf,
  variableNamesOf,
  viewKeyOf,
} from '../utils/inventory/price-private';

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
    expect(readCursor(cursorOf(3, 40))).toEqual({ version: 3, offset: 40 });
    expect(hasPrivateCursor(cursorOf(3, 40))).toBe(true);
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

describe('the private order field', () => {
  it('is told from the real ones, in the variables and in the text of a request', () => {
    expect(isPrivateField(privateFieldOf(2))).toBe(true);
    for (const field of ['CREATED_AT', 'RANK', null, undefined, 7]) expect(isPrivateField(field)).toBe(false);
    expect(isPrivateVariables(grid({ orderField: privateFieldOf(1) }))).toBe(true);
    expect(isPrivateVariables(grid())).toBe(false);
    expect(mentionsPrivateField(`{"variables":{"orderField":"${privateFieldOf(1)}"}}`)).toBe(true);
    expect(mentionsPrivateField('{"variables":{"orderField":"CREATED_AT"}}')).toBe(false);
  });

  it('is different for every version, so a rebuilt view is a different list for the cache', () => {
    expect(privateFieldOf(1)).not.toBe(privateFieldOf(2));
  });
});

describe('viewKeyOf', () => {
  it('ignores the cursor and the direction, and the order the names come in', () => {
    const reordered = { rank: { include: [] }, modifier: { include: [0] }, orderField: 'CREATED_AT', userId: 'USER:1', orderDirection: 'ASC', after: 'c9' };
    expect(viewKeyOf(reordered)).toBe(viewKeyOf(grid()));
    expect(viewKeyOf(grid({ after: undefined }))).toBe(viewKeyOf(grid()));
  });

  it('tells lists apart by user, field, filters and the names asked, so a picker of the same user is another list', () => {
    const key = viewKeyOf(grid());
    expect(viewKeyOf(grid({ userId: 'USER:2' }))).not.toBe(key);
    expect(viewKeyOf(grid({ orderField: 'RANK' }))).not.toBe(key);
    expect(viewKeyOf(grid({ modifier: { include: [1] } }))).not.toBe(key);
    expect(viewKeyOf(grid({ rank: { include: ['S'] } }))).not.toBe(key);
    expect(viewKeyOf(grid({ animated: null }))).not.toBe(key);
    expect(viewKeyOf(pickerOf(grid()))).not.toBe(key);
  });
});

describe('variableNamesOf', () => {
  it('names what is asked, without the cursor', () => {
    expect(variableNamesOf(grid())).toBe(variableNamesOf(grid({ after: 'c1', rank: { include: ['S'] } })));
    expect(variableNamesOf(grid({ after: undefined }))).toBe(variableNamesOf(grid()));
    expect(variableNamesOf(grid({ animated: null }))).not.toBe(variableNamesOf(grid()));
  });
});

describe('privateVariablesOf', () => {
  it('asks for the private field of the version and keeps everything else, the direction included', () => {
    expect(privateVariablesOf(grid({ orderDirection: 'ASC' }), 2)).toEqual({ ...grid({ orderDirection: 'ASC' }), orderField: privateFieldOf(2), after: null });
  });

  it('keeps the cursor of the same version and starts over for any other cursor', () => {
    expect(privateVariablesOf(grid({ after: cursorOf(2, 40) }), 2).after).toBe(cursorOf(2, 40));
    expect(privateVariablesOf(grid({ after: cursorOf(1, 40) }), 2).after).toBeNull();
    expect(privateVariablesOf(grid({ after: 'UgECAA_YJe18' }), 2).after).toBeNull();
    expect(privateVariablesOf(grid({ after: undefined }), 2).after).toBeNull();
  });
});

describe('realVariablesOf', () => {
  it('drops a private cursor and touches nothing else', () => {
    expect(realVariablesOf(grid({ after: cursorOf(2, 40) }))).toEqual(grid({ after: null }));
    const real = grid({ after: 'UgECAA_YJe18' });
    expect(realVariablesOf(real)).toBe(real);
  });
});
