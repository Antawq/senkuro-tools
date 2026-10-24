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
  it('says whether the view is wanted', () => {
    expect(readPriceSwitch(event(encodePriceSwitch(true)))).toBe(true);
    expect(readPriceSwitch(event(encodePriceSwitch(false)))).toBe(false);
  });

  it('is not read from anything else', () => {
    for (const detail of [undefined, 'nonsense', '{}', '{"isOn":1}', '[true]', 5, { isOn: true }]) expect(readPriceSwitch(event(detail))).toBeNull();
  });
});

describe('the state', () => {
  it('names the state and how far the list is', () => {
    expect(readPriceState(event(encodePriceState({ name: 'loading', loaded: 40, total: 100 })))).toEqual({ name: 'loading', loaded: 40, total: 100 });
    expect(readPriceState(event(encodePriceState({ name: 'failed', loaded: 0, total: null })))).toEqual({ name: 'failed', loaded: 0, total: null });
  });

  it('is not read when the name is not one or the count is not a count', () => {
    for (const detail of [
      '{"name":"done","loaded":0}',
      '{"name":"ready","loaded":-1}',
      '{"name":"ready","loaded":1.5}',
      '{"name":"ready"}',
      'nonsense',
      undefined,
    ]) {
      expect(readPriceState(event(detail))).toBeNull();
    }
    expect(readPriceState(event('{"name":"ready","loaded":3,"total":"7"}'))).toEqual({ name: 'ready', loaded: 3, total: null });
  });
});

describe('the rows', () => {
  it('carry the view they belong to and the slugs in the order of the list, with a null for a card without one', () => {
    const rows = { viewId: 4, slugs: ['a-a', null, 'b-b'] };
    expect(readPriceRows(event(encodePriceRows(rows)))).toEqual(rows);
  });

  it('are not read when the slugs are not slugs', () => {
    for (const detail of ['{"viewId":1,"slugs":[1]}', '{"viewId":1,"slugs":"a"}', '{"viewId":-1,"slugs":[]}', '{"slugs":[]}', 'nonsense']) {
      expect(readPriceRows(event(detail))).toBeNull();
    }
  });
});

describe('the order', () => {
  it('carries both directions for the view and the revision of the prices', () => {
    const order = { viewId: 4, revision: 2, descending: [2, 0, 1], ascending: [1, 0, 2] };
    expect(readPriceOrder(event(encodePriceOrder(order)))).toEqual(order);
  });

  it('is not read when a part is missing or is not a list of places', () => {
    for (const detail of [
      '{"viewId":1,"revision":1,"descending":[0]}',
      '{"viewId":1,"revision":1,"descending":[0],"ascending":["0"]}',
      '{"viewId":1,"revision":1.5,"descending":[0],"ascending":[0]}',
      '{"viewId":1,"revision":1,"descending":[-1],"ascending":[0]}',
      'nonsense',
    ]) {
      expect(readPriceOrder(event(detail))).toBeNull();
    }
  });
});
