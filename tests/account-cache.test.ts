import { describe, expect, it } from 'vitest';

import { packCards, unpackCards } from '../utils/account-cache';

describe('packed cards', () => {
  const cards = [
    { slug: 'a-a', quantity: 2, shard: false },
    { slug: 'b-b', quantity: 1, shard: true },
  ];

  it('stores every card as a short row', () => {
    expect(packCards(cards)).toEqual([
      ['a-a', 2, 0],
      ['b-b', 1, 1],
    ]);
  });

  it('reads back what it stored', () => {
    expect(unpackCards(JSON.parse(JSON.stringify(packCards(cards))))).toEqual(cards);
  });

  it('survives damaged data by dropping what it cannot read', () => {
    expect(unpackCards([['ok', 3, 0], 'junk', ['bad', '1', 0], ['flag', 1, 5], null, ['piece', 2, 1]])).toEqual([
      { slug: 'ok', quantity: 3, shard: false },
      { slug: 'piece', quantity: 2, shard: true },
    ]);
    expect(unpackCards('garbage')).toEqual([]);
  });
});
