import { storage } from 'wxt/utils/storage';

import { MS_PER_MINUTE } from '../shared/time';
import { packCards, unpackCards, type PageState } from './user-cards';

const LIFETIME_MINUTES = 10;
const LIFETIME_MS = LIFETIME_MINUTES * MS_PER_MINUTE;

export interface Collection extends PageState {
  at: number;
  userId: string;
}

interface StoredCollection {
  at: number;
  userId: string;
  cards: unknown;
  after: string | null;
  pages: number;
}

const COLLECTIONS = storage.defineItem<Record<string, unknown>>('local:profileCollections', { fallback: {} });

export const isComplete = ({ after, pages }: PageState): boolean => pages > 0 && after === null;

const isFresh = (entry: unknown, now: number): entry is StoredCollection => {
  const { at, userId, after, pages } = (entry ?? {}) as Partial<StoredCollection>;
  const readable = typeof at === 'number' && typeof userId === 'string' && typeof pages === 'number' && (after === null || typeof after === 'string');
  return readable && now - at <= LIFETIME_MS;
};

export async function readCollection(slug: string): Promise<Collection | null> {
  const entry = (await COLLECTIONS.getValue())[slug];
  if (!isFresh(entry, Date.now())) return null;
  return { at: entry.at, userId: entry.userId, cards: unpackCards(entry.cards), after: entry.after, pages: entry.pages };
}

export const warnStoreFailure = (error: unknown): null => {
  console.warn('SenkuTools: profile store', error);
  return null;
};

export async function forgetCollection(slug: string): Promise<void> {
  const kept = Object.entries(await COLLECTIONS.getValue()).filter(([key]) => key !== slug);
  await COLLECTIONS.setValue(Object.fromEntries(kept));
}

export async function saveCollection(slug: string, collection: Collection): Promise<void> {
  const now = Date.now();
  const kept = Object.entries(await COLLECTIONS.getValue()).filter(([key, entry]) => key !== slug && isFresh(entry, now));
  await COLLECTIONS.setValue({ ...Object.fromEntries(kept), [slug]: { ...collection, cards: packCards(collection.cards) } });
}
