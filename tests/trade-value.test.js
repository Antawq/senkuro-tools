import { describe, expect, it } from 'vitest';

import { compareR, compareSides, formatByRank, formatShardsByRank, hasR, valueSide } from '../utils/trade-value';

const db = {
  's-card': { price: 1.25, rank: 'S' },
  'a-card': { price: 1.5, rank: 'A' },
  'b-card': { price: 1.25, rank: 'B' },
  'c-card': { price: 1.25, rank: 'C' },
  'f-card': { price: 1.25, rank: 'F' },
  'd-card': { price: 2, rank: 'D' },
  'r-card': { price: 1.25, rank: 'R' },
};

const plain = { commission: true, valueBySplit: false, valueBasis: 'bank' };

const card = (slug, quantity = 1, shard = false) => ({ slug, quantity, shard });

describe('valueSide', () => {
  it('converts every forge rank into F at three cards per step', () => {
    const side = valueSide({ cards: [card('s-card'), card('a-card', 2), card('f-card'), card('d-card')], hidden: 0 }, db, plain);
    expect(side.f).toBeCloseTo(243 + 2 * 1.2 * 81 + 1 + 1.6 * 3);
    expect(formatByRank(side.bank)).toEqual(['1S', '2.4A', '1.6D', '1F']);
    expect(formatByRank(side.count)).toEqual(['1S', '2A', '1D', '1F']);
    expect(side.complete).toBe(true);
  });

  it('converts at two cards per step when the value follows splitting', () => {
    const side = valueSide({ cards: [card('s-card'), card('d-card'), card('s-card', 1, true)], hidden: 0 }, db, { ...plain, valueBySplit: true });
    expect(side.f).toBeCloseTo(32 + 1.6 * 2 + 32 / 10);
    expect(formatByRank(side.bank)).toEqual(['1S', '1.6D']);
    expect(formatShardsByRank(side.shards)).toEqual(['1oS']);
  });

  describe('when the total follows the cards instead of the bank', () => {
    const sides = { cards: [card('s-card'), card('a-card', 2), card('f-card'), card('d-card')], hidden: 0 };

    it('counts every card by its rank alone, whatever it costs', () => {
      const side = valueSide(sides, db, { ...plain, valueBasis: 'cards' });
      expect(side.f).toBeCloseTo(243 + 2 * 81 + 1 + 3);
      expect(valueSide(sides, db, { ...plain, commission: false, valueBasis: 'cards' }).f).toBeCloseTo(side.f);
    });

    it('leaves the bank and the card rows as they are', () => {
      const bank = valueSide(sides, db, plain);
      const cards = valueSide(sides, db, { ...plain, valueBasis: 'cards' });
      expect(formatByRank(cards.bank)).toEqual(formatByRank(bank.bank));
      expect(formatByRank(cards.count)).toEqual(formatByRank(bank.count));
      expect(cards.complete).toBe(bank.complete);
    });

    it('is what it was before when the basis is the bank, also when none is given', () => {
      expect(valueSide(sides, db, { ...plain, valueBasis: 'bank' }).f).toBeCloseTo(valueSide(sides, db, plain).f);
    });

    it('follows the splitting ratio too', () => {
      const side = valueSide({ cards: [card('s-card'), card('d-card'), card('s-card', 1, true)], hidden: 0 }, db, {
        ...plain,
        valueBySplit: true,
        valueBasis: 'cards',
      });
      expect(side.f).toBeCloseTo(32 + 2 + 32 / 10);
    });

    it('counts a shard as its share of the card, by the shards its rank needs', () => {
      const side = valueSide({ cards: [card('s-card', 3, true), card('f-card')], hidden: 0 }, db, { ...plain, valueBasis: 'cards' });
      expect(side.f).toBeCloseTo(1 + (3 * 243) / 10);
    });

    it('gives R as the number of its cards rather than its coins', () => {
      const side = valueSide({ cards: [card('r-card', 2), card('s-card')], hidden: 0 }, db, { ...plain, valueBasis: 'cards' });
      expect(side.r.value).toBe(2);
      expect(side.r.count).toBe(2);
      expect(side.f).toBeCloseTo(243);
      expect(valueSide({ cards: [card('r-card', 2)], hidden: 0 }, db, plain).r.value).toBeCloseTo(2 * 1.25 * 0.8);
    });

    it('still cannot settle hidden cards or cards missing from the database', () => {
      const side = valueSide({ cards: [card('s-card'), card('unlisted')], hidden: 2 }, db, { ...plain, valueBasis: 'cards' });
      expect(side.unknown).toBe(3);
      expect(side.complete).toBe(false);
    });
  });

  describe('when shards are left out of the value', () => {
    const noShards = { ...plain, excludeShards: true };
    const mixed = { cards: [card('s-card'), card('s-card', 3, true), card('r-card', 2, true), card('missing', 4, true)], hidden: 0 };

    it('drops shards from F and keeps whole cards', () => {
      const side = valueSide(mixed, db, noShards);
      expect(side.f).toBeCloseTo(243);
      expect(valueSide(mixed, db, plain).f).toBeCloseTo(243 + (3 * 243) / 10);
    });

    it('still lists the shards in the shard rows', () => {
      const side = valueSide(mixed, db, noShards);
      expect(formatShardsByRank(side.shards)).toEqual(['2oR', '3oS']);
      expect(formatShardsByRank(side.shardBank)).toEqual(['2oR', '3oS']);
      expect(side.hasShards).toBe(true);
    });

    it('does not let shards unsettle the total', () => {
      expect(valueSide(mixed, db, plain).complete).toBe(false);
      expect(valueSide(mixed, db, noShards).complete).toBe(true);
    });

    it('drops shards from the cards basis as well', () => {
      expect(valueSide(mixed, db, { ...noShards, valueBasis: 'cards' }).f).toBeCloseTo(243);
    });

    it('leaves the R branch with its cards only and settled', () => {
      const side = valueSide({ cards: [card('r-card', 2), card('r-card', 2, true)], hidden: 0 }, db, noShards);
      expect(side.r).toEqual({ value: 2 * 1.25 * 0.8, count: 2, shards: 0, complete: true });
    });

    it('still cannot settle hidden cards', () => {
      expect(valueSide({ cards: [card('s-card', 1, true)], hidden: 1 }, db, noShards).complete).toBe(false);
    });
  });

  it('uses the raw base price when the commission is off', () => {
    expect(valueSide({ cards: [card('s-card')], hidden: 0 }, db, { ...plain, commission: false }).f).toBeCloseTo(1.25 * 243);
  });

  it('counts a shard as its share of the card it assembles into', () => {
    const side = valueSide({ cards: [card('s-card', 3, true), card('f-card')], hidden: 0 }, db, plain);
    expect(side.f).toBeCloseTo(1 + (3 * 243) / 10);
    expect(formatByRank(side.count)).toEqual(['1F']);
    expect(formatByRank(side.bank)).toEqual(['1F']);
    expect(formatShardsByRank(side.shards)).toEqual(['3oS']);
    expect(side.hasShards).toBe(true);
  });

  it.each([
    ['s-card', (1 * 243) / 10],
    ['a-card', (1.2 * 81) / 8],
    ['b-card', (1 * 27) / 6],
    ['c-card', (1 * 9) / 4],
    ['d-card', (1.6 * 3) / 2],
  ])('values a shard of %s by the number of shards its rank needs', (slug, expected) => {
    const side = valueSide({ cards: [card(slug, 1, true)], hidden: 0 }, db, plain);
    expect(side.f).toBeCloseTo(expected);
    expect(side.complete).toBe(true);
  });

  it('values a whole stack of shards as the sum of its shards', () => {
    const one = valueSide({ cards: [card('a-card', 1, true)], hidden: 0 }, db, plain);
    const eight = valueSide({ cards: [card('a-card', 8, true)], hidden: 0 }, db, plain);
    expect(eight.f).toBeCloseTo(one.f * 8);
    expect(eight.f).toBeCloseTo(1.2 * 81);
  });

  it('puts shards into the bank at their shard value based on card price', () => {
    const side = valueSide({ cards: [card('d-card', 78, true), card('b-card', 2, true), card('r-card', 3, true), card('s-card')], hidden: 0 }, db, plain);
    expect(formatShardsByRank(side.shardBank)).toEqual(['3oR', '2oB', '124.8oD']);
    expect(formatByRank(side.bank)).toEqual(['1S']);
    expect(formatShardsByRank(side.shards)).toEqual(['3oR', '2oB', '78oD']);
  });

  it('marks shards of a card missing from the database apart from unknown cards', () => {
    const side = valueSide({ cards: [card('missing', 4, true)], hidden: 0 }, db, plain);
    expect(side.unknown).toBe(0);
    expect(side.shardUnknown).toBe(4);
    expect(side.complete).toBe(false);
  });

  it('keeps shards of R out of the F total and lists them on the R branch', () => {
    const side = valueSide({ cards: [card('r-card', 2, true)], hidden: 0 }, db, plain);
    expect(side.f).toBe(0);
    expect(formatShardsByRank(side.shards)).toEqual(['2oR']);
    expect(side.r).toEqual({ value: 0, count: 0, shards: 2, complete: false });
    expect(side.complete).toBe(true);
  });

  it('marks hidden cards and cards missing from the database as unknown', () => {
    const side = valueSide({ cards: [card('f-card'), card('missing', 2)], hidden: 3 }, db, plain);
    expect(side.unknown).toBe(5);
    expect(side.f).toBeCloseTo(1);
    expect(side.complete).toBe(false);
  });

  it('keeps R out of the F total and counts it as a branch of its own', () => {
    const side = valueSide({ cards: [card('r-card', 3)], hidden: 0 }, db, plain);
    expect(side.f).toBe(0);
    expect(formatByRank(side.bank)).toEqual(['3R']);
    expect(formatByRank(side.count)).toEqual(['3R']);
    expect(side.r).toEqual({ value: 3, count: 3, shards: 0, complete: true });
    expect(side.complete).toBe(true);
  });

  it('values R at its own price whatever the forge ratio is', () => {
    const cards = [card('r-card', 2)];
    expect(valueSide({ cards, hidden: 0 }, db, plain).r.value).toBeCloseTo(2);
    expect(valueSide({ cards, hidden: 0 }, db, { ...plain, commission: false }).r.value).toBeCloseTo(2.5);
    expect(valueSide({ cards, hidden: 0 }, db, { ...plain, valueBySplit: true }).r.value).toBeCloseTo(2);
  });

  it('keeps the other ranks in F when R sits beside them', () => {
    const side = valueSide({ cards: [card('s-card'), card('r-card', 2)], hidden: 0 }, db, plain);
    expect(side.f).toBeCloseTo(243);
    expect(side.r.value).toBeCloseTo(2);
    expect(formatByRank(side.bank)).toEqual(['2R', '1S']);
  });

  it('cannot settle R while a card of an unknown rank is on the side', () => {
    const side = valueSide({ cards: [card('r-card'), card('missing')], hidden: 0 }, db, plain);
    expect(side.r.complete).toBe(false);
    expect(side.complete).toBe(false);
  });

  it('still flags a rank the forge and R both do not know', () => {
    const side = valueSide({ cards: [card('x-card')], hidden: 0 }, { 'x-card': { price: 1.25, rank: 'X' } }, true);
    expect(side.beyondF).toBe(true);
    expect(side.complete).toBe(false);
    expect(hasR(side)).toBe(false);
  });
});

describe('compareSides', () => {
  const side = (f, complete = true) => ({ f, complete });

  it('reports the gain relative to what is given', () => {
    expect(compareSides(side(243), side(777.6))).toEqual({ kind: 'gain', text: 'Выгода +534.6F (+220%)', certain: true });
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

  it('is uncertain only when a side with unknown cards has nothing priced', () => {
    expect(compareSides(side(1), side(1, false)).certain).toBe(true);
    expect(compareSides(side(1), side(0, false)).certain).toBe(false);
  });

  it('lets shards decide the verdict together with whole cards', () => {
    const give = valueSide({ cards: [card('s-card')], hidden: 0 }, db, plain);
    const get = valueSide({ cards: [card('s-card', 5, true)], hidden: 0 }, db, plain);
    expect(compareSides(give, get).text).toBe('Потеря -121.5F (-50%)');
  });
});

describe('formatShardsByRank', () => {
  it('labels shards with a lowercase o and orders them from the highest rank', () => {
    expect(
      formatShardsByRank(
        new Map([
          ['A', 2],
          ['S', 1],
          ['F', 0.5],
        ])
      )
    ).toEqual(['1oS', '2oA', '0.5oF']);
  });
});

describe('hasR', () => {
  it('is true for R cards or R shards and false otherwise', () => {
    expect(hasR(valueSide({ cards: [card('r-card')], hidden: 0 }, db, plain))).toBe(true);
    expect(hasR(valueSide({ cards: [card('r-card', 1, true)], hidden: 0 }, db, plain))).toBe(true);
    expect(hasR(valueSide({ cards: [card('s-card')], hidden: 0 }, db, plain))).toBe(false);
    expect(hasR(valueSide({ cards: [], hidden: 0 }, db, plain))).toBe(false);
  });
});

describe('compareR', () => {
  const sideOf = (cards) => valueSide({ cards, hidden: 0 }, db, plain);

  it('says nothing when neither side has R', () => {
    expect(compareR(sideOf([card('s-card')]), sideOf([card('a-card')]))).toBeNull();
  });

  it('reports the gain and the loss in R', () => {
    expect(compareR(sideOf([card('r-card')]), sideOf([card('r-card', 3)]))).toEqual({ kind: 'gain', text: 'R: Выгода +2R (+200%)', certain: true });
    expect(compareR(sideOf([card('r-card', 4)]), sideOf([card('r-card')])).text).toBe('R: Потеря -3R (-75%)');
  });

  it('drops the percentage when no R is given', () => {
    expect(compareR(sideOf([card('s-card')]), sideOf([card('r-card', 2)])).text).toBe('R: Выгода +2R');
  });

  it('calls equal R amounts even', () => {
    expect(compareR(sideOf([card('r-card')]), sideOf([card('r-card')])).kind).toBe('even');
  });

  it('is uncertain only when a side holds nothing but unvalued R', () => {
    expect(compareR(sideOf([card('r-card')]), sideOf([card('r-card', 1, true)])).certain).toBe(false);
    expect(compareR(sideOf([card('r-card'), card('missing')]), sideOf([card('r-card')])).certain).toBe(true);
  });
});
