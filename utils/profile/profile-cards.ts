import type { Database } from '../shared/database';
import { execute, type Transport } from '../shared/graphql';
import { F_UNIT, R_RANK, UNKNOWN_MARK, formatAmount, formatByRank, formatShardsByRank, valueSide, type Valuation } from '../shared/trade-value';
import { decodeSafely } from '../shared/uri';
import { fetchUserCards, type FetchOptions, type UserCard } from './user-cards';

export interface ProfileValueSummary {
  totalF: number;
  formattedF: string;
  bank: string[];
  cards: string[];
  shards: string[];
  shardBank: string[];
  totalCards: number;
  totalShards: number;
}

const USER_BY_SLUG = 'query User($slug: String!) { user(slug: $slug) { id name } }';
const PROFILE_PATH = /^\/users\/([^/?#]+)/;
const RESERVED_PATHS = ['settings', 'notifications', 'card-trades'];
const R_SLUG_SUFFIX = `-${R_RANK.toLowerCase()}`;

interface UserData {
  user?: { id?: string; name?: string | null } | null;
}

export async function fetchProfileUser(slug: string, transport?: Transport, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
  const data = await execute<UserData>(null, USER_BY_SLUG, 'User', { slug }, transport, signal);
  const user = data?.user;
  if (!user?.id) return null;
  return { id: String(user.id), name: user.name || slug };
}

export const fetchProfileCards = (userId: string, options?: FetchOptions, transport?: Transport): Promise<UserCard[]> =>
  fetchUserCards(null, userId, options, transport);

const rankOf = (slug: string, db: Database): string => db[slug]?.rank || (slug.endsWith(R_SLUG_SUFFIX) ? R_RANK : UNKNOWN_MARK);

const sumQuantity = (cards: UserCard[]): number => cards.reduce((total, card) => total + card.quantity, 0);

const countByRank = (cards: UserCard[], db: Database): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const rank = rankOf(card.slug, db);
    counts.set(rank, (counts.get(rank) ?? 0) + card.quantity);
  }
  return counts;
};

export function calculateProfileValue(cards: UserCard[], db: Database, valuation: Valuation): ProfileValueSummary {
  const value = valueSide({ cards, hidden: 0 }, db, valuation);
  const whole = cards.filter((card) => !card.shard);
  const shards = cards.filter((card) => card.shard);
  return {
    totalF: value.f,
    formattedF: `${formatAmount(value.f)}${F_UNIT}`,
    bank: formatByRank(value.bank),
    cards: formatByRank(countByRank(whole, db)),
    shards: formatShardsByRank(countByRank(shards, db)),
    shardBank: formatShardsByRank(value.shardBank),
    totalCards: sumQuantity(whole),
    totalShards: sumQuantity(shards),
  };
}

export function extractProfileSlug(pathname: string): string | null {
  const match = PROFILE_PATH.exec(pathname);
  if (!match) return null;
  const raw = decodeSafely(match[1] || '').trim();
  if (!raw || RESERVED_PATHS.includes(raw)) return null;
  return raw;
}
