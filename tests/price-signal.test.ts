import { describe, expect, it } from 'vitest';

import { priceOrderSignal, priceRowsSignal, priceStateSignal, priceViewSignal, type ScopedOrder, type ScopedRows } from '../utils/shared/price-signal';

const event = (detail?: unknown) => new CustomEvent('x', detail === undefined ? undefined : { detail });

describe('the switch', () => {
  it('says whether the view is wanted, for which list, and in which order', () => {
    expect(priceViewSignal.read(event(priceViewSignal.encode({ scope: 'grid', isOn: true, sort: 'price' })))).toEqual({
      scope: 'grid',
      isOn: true,
      sort: 'price',
    });
    expect(priceViewSignal.read(event(priceViewSignal.encode({ scope: 'picker', isOn: false, sort: 'site' })))).toEqual({
      scope: 'picker',
      isOn: false,
      sort: 'site',
    });
  });

  it('is not read from anything else, nor without a list it knows', () => {
    for (const detail of [
      undefined,
      'nonsense',
      '{}',
      '{"scope":"grid","isOn":1,"sort":"price"}',
      '{"isOn":true,"sort":"price"}',
      '{"scope":"deck","isOn":true,"sort":"price"}',
      '{"scope":"grid","isOn":true}',
      '{"scope":"grid","isOn":true,"sort":"rank"}',
      '[true]',
      5,
      { isOn: true },
    ]) {
      expect(priceViewSignal.read(event(detail))).toBeNull();
    }
  });
});

describe('the state', () => {
  it('names the list, the state and how far the list is', () => {
    expect(priceStateSignal.read(event(priceStateSignal.encode({ scope: 'grid', name: 'loading', loaded: 40, total: 100 })))).toEqual({
      scope: 'grid',
      name: 'loading',
      loaded: 40,
      total: 100,
    });
    expect(priceStateSignal.read(event(priceStateSignal.encode({ scope: 'picker', name: 'failed', loaded: 0, total: null })))).toEqual({
      scope: 'picker',
      name: 'failed',
      loaded: 0,
      total: null,
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
      expect(priceStateSignal.read(event(detail))).toBeNull();
    }
    expect(priceStateSignal.read(event('{"scope":"grid","name":"ready","loaded":3,"total":"7"}'))).toEqual({
      scope: 'grid',
      name: 'ready',
      loaded: 3,
      total: null,
    });
  });
});

describe('the rows', () => {
  it('carry the list and the view they belong to and the slugs in the order of the list, with a null for a card without one', () => {
    const rows: ScopedRows = { scope: 'picker', viewId: 4, slugs: ['a-a', null, 'b-b'] };
    expect(priceRowsSignal.read(event(priceRowsSignal.encode(rows)))).toEqual(rows);
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
      expect(priceRowsSignal.read(event(detail))).toBeNull();
    }
  });
});

describe('the order', () => {
  it('carries the list, both directions for the view and the revision of the prices', () => {
    const order: ScopedOrder = { scope: 'grid', viewId: 4, revision: 2, descending: [2, 0, 1], ascending: [1, 0, 2] };
    expect(priceOrderSignal.read(event(priceOrderSignal.encode(order)))).toEqual(order);
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
      expect(priceOrderSignal.read(event(detail))).toBeNull();
    }
  });
});
