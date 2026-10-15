import { describe, expect, it } from 'vitest';

import type { UserCard } from '../utils/user-cards';
import { calculateProfileValue, extractProfileSlug, fetchProfileCards, fetchProfileUser } from '../utils/profile-cards';

const plain = { commission: false, valueBySplit: false, valueBasis: 'bank' as const };

const mockDb = {
  'soran-f': { price: 1.25, name: 'Соран', rank: 'F' },
  'luffy-s': { price: 5.0, name: 'Луффи', rank: 'S' },
  'zoro-r': { price: 2.0, name: 'Зоро', rank: 'R' },
  'nami-d': { price: 2.5, name: 'Нами', rank: 'D' },
};

describe('profile-cards', () => {
  describe('extractProfileSlug', () => {
    it('extracts slug from simple profile url', () => {
      expect(extractProfileSlug('/users/tokunbek')).toBe('tokunbek');
    });

    it('extracts slug with @ prefix and sub-routes', () => {
      expect(extractProfileSlug('/users/@12345/cards')).toBe('@12345');
    });

    it('returns null on non-user routes or reserved paths', () => {
      expect(extractProfileSlug('/cards/soran')).toBeNull();
      expect(extractProfileSlug('/users/settings')).toBeNull();
      expect(extractProfileSlug('/users/notifications')).toBeNull();
    });

    it('keeps a slug with a broken escape instead of throwing', () => {
      expect(extractProfileSlug('/users/%E0%A4%A')).toBe('%E0%A4%A');
    });
  });

  describe('fetchProfileUser', () => {
    it('queries user by slug and returns id and name', async () => {
      const mockTransport = {
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ data: { user: { id: 'usr-99', slug: 'tokunbek', name: 'Токунбек' } } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          ),
        sleep: () => Promise.resolve(),
        random: () => 0,
      };

      const user = await fetchProfileUser('@tokunbek', mockTransport);
      expect(user).toEqual({ id: 'usr-99', name: 'Токунбек' });
    });

    it('returns null if user is not found', async () => {
      const mockTransport = {
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ data: { user: null } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          ),
        sleep: () => Promise.resolve(),
        random: () => 0,
      };

      const user = await fetchProfileUser('unknown', mockTransport);
      expect(user).toBeNull();
    });
  });

  describe('fetchProfileCards', () => {
    it('fetches and flattens user card pages', async () => {
      let page = 0;
      const mockTransport = {
        fetch: () => {
          page++;
          const data =
            page === 1
              ? {
                  userCards: {
                    pageInfo: { hasNextPage: true, endCursor: 'cur-1' },
                    edges: [
                      { node: { quantity: 2, shard: false, card: { slug: 'soran-f' } } },
                      { node: { quantity: 1, shard: true, card: { slug: 'nami-d' } } },
                    ],
                  },
                }
              : {
                  userCards: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    edges: [{ node: { quantity: 1, shard: false, card: { slug: 'luffy-s' } } }],
                  },
                };
          return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
        },
        sleep: () => Promise.resolve(),
        random: () => 0,
      };

      const progress: number[] = [];
      const cards = await fetchProfileCards('usr-99', (count) => progress.push(count), mockTransport);

      expect(cards).toHaveLength(3);
      expect(cards[0]).toEqual({ slug: 'soran-f', quantity: 2, shard: false });
      expect(cards[1]).toEqual({ slug: 'nami-d', quantity: 1, shard: true });
      expect(cards[2]).toEqual({ slug: 'luffy-s', quantity: 1, shard: false });
      expect(progress).toEqual([2, 3]);
    });
  });

  describe('calculateProfileValue', () => {
    it('calculates total value in F, bank, and shards', () => {
      const cards: UserCard[] = [
        { slug: 'soran-f', quantity: 1, shard: false },
        { slug: 'luffy-s', quantity: 1, shard: false },
        { slug: 'zoro-r', quantity: 2, shard: false },
      ];

      const summary = calculateProfileValue(cards, mockDb, plain);
      expect(summary.totalCards).toBe(4);
      expect(summary.totalShards).toBe(0);
      expect(summary.totalF).toBeGreaterThan(0);
      expect(summary.formattedF).toContain('F');
      expect(summary.rValue).toBe('4R');
      expect(summary.rCards).toBe(2);
      expect(summary.cards[0]).toBe('2R');
    });

    it('follows the same valuation as the trade summary', () => {
      const cards: UserCard[] = [{ slug: 'luffy-s', quantity: 1, shard: false }];
      expect(calculateProfileValue(cards, mockDb, plain).formattedF).toBe('1215F');
      expect(calculateProfileValue(cards, mockDb, { ...plain, commission: true }).formattedF).toBe('972F');
      expect(calculateProfileValue(cards, mockDb, { ...plain, valueBySplit: true }).formattedF).toBe('160F');
      expect(calculateProfileValue(cards, mockDb, { ...plain, valueBasis: 'cards' }).formattedF).toBe('243F');
    });

    it('counts an R card the database does not know yet by its slug', () => {
      const summary = calculateProfileValue([{ slug: 'new-hero-r', quantity: 3, shard: false }], mockDb, plain);
      expect(summary.cards).toEqual(['3R']);
    });
  });
});
