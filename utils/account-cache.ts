import { storage } from 'wxt/utils/storage';

import type { AccountCard } from './account-cards';

export interface AccountSnapshot {
  at: number;
  cards: AccountCard[];
}

type StoredCard = [string, number, 0 | 1];

interface Stored {
  at: number;
  cards: StoredCard[];
}

const SNAPSHOT = storage.defineItem<Stored>('local:accountCards');

const isStoredCard = (value: unknown): value is StoredCard =>
  Array.isArray(value) && value.length === 3 && typeof value[0] === 'string' && typeof value[1] === 'number' && (value[2] === 0 || value[2] === 1);

export const packCards = (cards: AccountCard[]): StoredCard[] => cards.map(({ slug, quantity, shard }): StoredCard => [slug, quantity, shard ? 1 : 0]);

export const unpackCards = (list: unknown): AccountCard[] =>
  Array.isArray(list) ? list.filter(isStoredCard).map(([slug, quantity, shard]) => ({ slug, quantity, shard: shard === 1 })) : [];

export async function loadSnapshot(): Promise<AccountSnapshot | null> {
  const stored = await SNAPSHOT.getValue();
  if (!stored || typeof stored.at !== 'number' || !Array.isArray(stored.cards)) return null;
  return { at: stored.at, cards: unpackCards(stored.cards) };
}

export const saveSnapshot = (cards: AccountCard[], at: number): Promise<void> => SNAPSHOT.setValue({ at, cards: packCards(cards) });

export const clearSnapshot = (): Promise<void> => SNAPSHOT.removeValue();
