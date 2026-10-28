import { describe, expect, it } from 'vitest';

import {
  encodePriceOrder,
  encodePriceRows,
  encodePriceState,
  encodePriceSwitch,
  readPriceOrder,
  readPriceRows,
  readPriceState,
  readPriceSwitch,
} from '../utils/shared/price-signal';

const event = (detail?: unknown) => new CustomEvent('x', detail === undefined ? undefined : { detail });

describe('the switch', () => {
  it('says whether the view is wanted, and for which list', () => {
    expect(readPriceSwitch(event(encodePriceSwitch({ scope: 'grid', isOn: true })))).toEqual({ scope: 'grid', isOn: true });
    expect(readPriceSwitch(event(encodePriceSwitch({ scope: 'picker', isOn: false })))).toEqual({ scope: 'picker', isOn: false });
  });

  it('is not read from anything else, nor without a list it knows', () => {
    for (const detail of [
      undefined,
      'nonsense',
      '{}',
      '{"scope":"grid","isOn":1}',
      '{"isOn":true}',
      '{"scope":"deck","isOn":true}',
      '[true]',
      5,
      { isOn: true },
    ]) {
      expect(readPriceSwitch(event(detail))).toBeNull();
    }
  });
});

describe('the state', () => {
  it('names the list, the state and how far the list is', () => {
    expect(readPriceState(event(encodePriceState({ scope: 'grid', state: { name: 'loading', loaded: 40, total: 100 } })))).toEqual({
      scope: 'grid',
      state: { name: 'loading', loaded: 40, total: 100 },
    });
    expect(readPriceState(event(encodePriceState({ scope: 'picker', state: { name: 'failed', loaded: 0, total: null } })))).toEqual({
      scope: 'picker',
      state: { name: 'failed', loaded: 0, total: null },
    });
  });

  it('is not read when the list, the name or the count is not one', () => {
    for (const detail of [
      '{"scope":"grid","name":"done","loaded":0}',
      '{"scope":"grid","name":"ready","loaded":-1}',
      '{"scope":"grid","name":"ready","loaded":1.5}',
      '{"scope":"grid","name":"ready"}',
      '{"name":"ready","loaded":0}',
      'nonsense',
      undefined,
    ]) {
      expect(readPriceState(event(detail))).toBeNull();
    }
    expect(readPriceState(event('{"scope":"grid","name":"ready","loaded":3,"total":"7"}'))).toEqual({
      scope: 'grid',
      state: { name: 'ready', loaded: 3, total: null },
    });
  });
});

describe('the rows', () => {
  it('carry the list and the view they belong to and the slugs in the order of the list, with a null for a card without one', () => {
    const rows = { viewId: 4, slugs: ['a-a', null, 'b-b'] };
    expect(readPriceRows(event(encodePriceRows({ scope: 'picker', rows })))).toEqual({ scope: 'picker', rows });
  });

  it('are not read when the slugs are not slugs or the list is not named', () => {
    for (const detail of [
      '{"scope":"grid","viewId":1,"slugs":[1]}',
      '{"scope":"grid","viewId":1,"slugs":"a"}',
      '{"scope":"grid","viewId":-1,"slugs":[]}',
      '{"scope":"grid","slugs":[]}',
      '{"viewId":1,"slugs":[]}',
      'nonsense',
    ]) {
      expect(readPriceRows(event(detail))).toBeNull();
    }
  });
});

describe('the order', () => {
  it('carries the list, both directions for the view and the revision of the prices', () => {
    const order = { viewId: 4, revision: 2, descending: [2, 0, 1], ascending: [1, 0, 2] };
    expect(readPriceOrder(event(encodePriceOrder({ scope: 'grid', order })))).toEqual({ scope: 'grid', order });
  });

  it('is not read when a part is missing or is not a list of places', () => {
    for (const detail of [
      '{"scope":"grid","viewId":1,"revision":1,"descending":[0]}',
      '{"scope":"grid","viewId":1,"revision":1,"descending":[0],"ascending":["0"]}',
      '{"scope":"grid","viewId":1,"revision":1.5,"descending":[0],"ascending":[0]}',
      '{"scope":"grid","viewId":1,"revision":1,"descending":[-1],"ascending":[0]}',
      '{"viewId":1,"revision":1,"descending":[0],"ascending":[0]}',
      'nonsense',
    ]) {
      expect(readPriceOrder(event(detail))).toBeNull();
    }
  });
});
