import { describe, expect, it } from 'vitest';

import type { AccountCard } from '../utils/account-cards';
import { summarizeAccount } from '../utils/account-summary';

const db = {
  's-card': { price: 1.25, name: 'S', rank: 'S' },
  'a-card': { price: 1.5, name: 'A', rank: 'A' },
  'd-card': { price: 2, name: 'D', rank: 'D' },
  'f-card': { price: 1.25, name: 'F', rank: 'F' },
  'r-card': { price: 1.25, name: 'R', rank: 'R' },
};

const own = (slug: string, quantity = 1, shard = false): AccountCard => ({ slug, quantity, shard });

describe('summarizeAccount', () => {
  const inventory = [own('s-card', 2), own('a-card'), own('f-card', 10), own('missing', 3), own('s-card', 4, true)];

  it('counts the cards and adds up the coins of the bank at the price after commission', () => {
    const summary = summarizeAccount(inventory, db, true);
    expect(summary.cards).toBe(16);
    expect(summary.bank).toBeCloseTo(2 + 1.2 + 10);
    expect(summary.bankByRank).toEqual(['2S', '1.2A', '10F']);
    expect(summary.cardsByRank).toEqual(['2S', '1A', '10F']);
  });

  it('adds up the raw prices when the commission is off', () => {
    const summary = summarizeAccount(inventory, db, false);
    expect(summary.bank).toBeCloseTo(2.5 + 1.5 + 12.5);
    expect(summary.bankByRank).toEqual(['2.5S', '1.5A', '12.5F']);
  });

  it('counts distinct cards, shards and the cards that have no price', () => {
    const summary = summarizeAccount(inventory, db, true);
    expect(summary.unique).toBe(4);
    expect(summary.shards).toBe(4);
    expect(summary.unpriced).toBe(3);
  });

  it('counts a card once as distinct however many entries hold it', () => {
    const summary = summarizeAccount([own('s-card'), own('s-card', 2), own('a-card')], db, true);
    expect(summary.cards).toBe(4);
    expect(summary.unique).toBe(2);
  });

  it('keeps shards out of the bank and out of the card count', () => {
    const summary = summarizeAccount([own('s-card', 5, true)], db, true);
    expect(summary).toMatchObject({ cards: 0, unique: 0, shards: 5, bank: 0, bankByRank: [], cardsByRank: [] });
  });

  it('shows no R branch when the account has no R', () => {
    expect(summarizeAccount(inventory, db, true).r).toBeNull();
  });

  it('counts R apart from the bank but among the cards', () => {
    const summary = summarizeAccount([...inventory, own('r-card', 2)], db, true);
    expect(summary.r).toEqual({ cards: 2, coins: 2, shards: 0 });
    expect(summary.cards).toBe(18);
    expect(summary.bank).toBeCloseTo(2 + 1.2 + 10);
    expect(summary.bankByRank).toEqual(['2S', '1.2A', '10F']);
    expect(summary.cardsByRank).toEqual(['2S', '1A', '10F']);
  });

  it('opens the R branch for R shards alone', () => {
    expect(summarizeAccount([own('r-card', 3, true)], db, true).r).toEqual({ cards: 0, coins: 0, shards: 3 });
  });

  it('answers zeros for an empty account', () => {
    expect(summarizeAccount([], db, true)).toEqual({ cards: 0, unique: 0, shards: 0, unpriced: 0, bank: 0, bankByRank: [], cardsByRank: [], r: null });
  });

  it('leaves every card unpriced when the database is empty', () => {
    const summary = summarizeAccount(inventory, {}, true);
    expect(summary).toMatchObject({ cards: 16, unpriced: 16, bank: 0 });
  });
});
