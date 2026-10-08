import { describe, expect, it } from 'vitest';

import { compareShards, compareSides, formatByRank, valueSide } from '../utils/trade-value';

const db = {
  's-card': { price: 1.25, rank: 'S' },
  'a-card': { price: 1.5, rank: 'A' },
  'f-card': { price: 1.25, rank: 'F' },
  'd-card': { price: 2, rank: 'D' },
  'r-card': { price: 1.25, rank: 'R' },
};

const card = (slug, quantity = 1, shard = false) => ({ slug, quantity, shard });

describe('valueSide', () => {
  it('converts every forge rank into F at three cards per step', () => {
    const side = valueSide({ cards: [card('s-card'), card('a-card', 2), card('f-card'), card('d-card')], hidden: 0 }, db, true);
    expect(side.f).toBeCloseTo(243 + 2 * 1.2 * 81 + 1 + 1.6 * 3);
    expect(formatByRank(side.bank)).toEqual(['1S', '2.4A', '1.6D', '1F']);
    expect(formatByRank(side.count)).toEqual(['1S', '2A', '1D', '1F']);
    expect(side.complete).toBe(true);
  });

  it('uses the raw base price when the commission is off', () => {
    expect(valueSide({ cards: [card('s-card')], hidden: 0 }, db, false).f).toBeCloseTo(1.25 * 243);
  });

  it('keeps shards apart from whole cards as their own currency', () => {
    const side = valueSide({ cards: [card('s-card', 3, true), card('f-card')], hidden: 0 }, db, true);
    expect(side.f).toBeCloseTo(1);
    expect(formatByRank(side.count)).toEqual(['1F']);
    expect(formatByRank(side.shards)).toEqual(['3S']);
    expect(side.shardF).toBeCloseTo(3 * 243);
    expect(side.hasShards).toBe(true);
  });

  it('marks shards of a card missing from the database apart from unknown cards', () => {
    const side = valueSide({ cards: [card('missing', 4, true)], hidden: 0 }, db, true);
    expect(side.unknown).toBe(0);
    expect(side.shardUnknown).toBe(4);
    expect(side.shardsComplete).toBe(false);
  });

  it('marks hidden cards and cards missing from the database as unknown', () => {
    const side = valueSide({ cards: [card('f-card'), card('missing', 2)], hidden: 3 }, db, true);
    expect(side.unknown).toBe(5);
    expect(side.f).toBeCloseTo(1);
    expect(side.complete).toBe(false);
  });

  it('keeps R out of the F total because the forge never yields it', () => {
    const side = valueSide({ cards: [card('r-card')], hidden: 0 }, db, true);
    expect(side.f).toBe(0);
    expect(formatByRank(side.bank)).toEqual(['1R']);
    expect(side.complete).toBe(false);
  });
});

describe('compareSides', () => {
  const side = (f, complete = true) => ({ f, complete });

  it('reports the gain relative to what is given', () => {
    expect(compareSides(side(243), side(777.6))).toEqual({ kind: 'gain', text: 'Выгода +534.6F (+220%)', complete: true });
  });

  it('reports the loss relative to what is given', () => {
    expect(compareSides(side(10.8), side(1)).text).toBe('Потеря -9.8F (-91%)');
  });

  it('calls equal totals even', () => {
    expect(compareSides(side(1263.6), side(1263.6)).kind).toBe('even');
  });

  it('drops the percentage when nothing is given', () => {
    expect(compareSides(side(0), side(81)).text).toBe('Выгода +81F');
  });

  it('is incomplete when either side has unknown cards', () => {
    expect(compareSides(side(1), side(1, false)).complete).toBe(false);
  });

  it('compares shards on a line of their own priced like their cards', () => {
    const give = { f: 243, complete: true, hasShards: false, shardF: 0, shardsComplete: true };
    const get = { f: 0, complete: true, hasShards: true, shardF: 243, shardsComplete: true };
    expect(compareSides(give, get).text).toBe('Потеря -243F (-100%)');
    expect(compareShards(give, get).text).toBe('Осколки: Выгода +243F');
    expect(compareShards(give, { ...get, hasShards: false })).toBeNull();
  });
});
