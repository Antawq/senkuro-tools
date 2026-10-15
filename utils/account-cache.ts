import type { AccountCard } from './account-cards';

type StoredCard = [string, number, 0 | 1];

const isStoredCard = (value: unknown): value is StoredCard =>
  Array.isArray(value) && value.length === 3 && typeof value[0] === 'string' && typeof value[1] === 'number' && (value[2] === 0 || value[2] === 1);

export const packCards = (cards: AccountCard[]): StoredCard[] => cards.map(({ slug, quantity, shard }): StoredCard => [slug, quantity, shard ? 1 : 0]);

export const unpackCards = (list: unknown): AccountCard[] =>
  Array.isArray(list) ? list.filter(isStoredCard).map(([slug, quantity, shard]) => ({ slug, quantity, shard: shard === 1 })) : [];
