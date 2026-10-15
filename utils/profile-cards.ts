import { fetchUserCards, type AccountCard } from './account-cards';
import type { Database } from './database';
import { execute, type Transport } from './graphql';
import { F_UNIT, R_RANK, formatAmount, formatByRank, formatShardsByRank, hasR, valueWith, type Valuation } from './trade-value';
import { decodeSafely } from './uri';

export interface ProfileValueSummary {
  totalF: number;
  formattedF: string;
  bank: string[];
  cards: string[];
  shards: string[];
  shardBank: string[];
  totalCards: number;
  totalShards: number;
  rValue: string | null;
  rCards: number;
}

const USER_BY_SLUG = 'query User($slug: String!) { user(slug: $slug) { id name } }';
const PROFILE_PATH = /^\/users\/([^/?#]+)/;
const RESERVED_PATHS = ['settings', 'notifications', 'card-trades'];
const R_SLUG_SUFFIX = `-${R_RANK.toLowerCase()}`;

interface UserData {
  user?: { id?: string; name?: string | null } | null;
}

export async function fetchProfileUser(slug: string, transport?: Transport): Promise<{ id: string; name: string } | null> {
  const data = await execute<UserData>(null, USER_BY_SLUG, 'User', { slug }, transport);
  const user = data?.user;
  if (!user?.id) return null;
  return { id: String(user.id), name: user.name || slug };
}

export const fetchProfileCards = (userId: string, onProgress?: (loaded: number) => void, transport?: Transport): Promise<AccountCard[]> =>
  fetchUserCards(null, userId, onProgress, transport);

const rankOf = (slug: string, db: Database): string | null => db[slug]?.rank || (slug.endsWith(R_SLUG_SUFFIX) ? R_RANK : null);

const sumQuantity = (cards: AccountCard[]): number => cards.reduce((total, card) => total + card.quantity, 0);

export function calculateProfileValue(cards: AccountCard[], db: Database, valuation: Valuation): ProfileValueSummary {
  const value = valueWith({ cards, hidden: 0 }, db, valuation);
  const whole = cards.filter((card) => !card.shard);
  const counts = new Map<string, number>();
  for (const card of whole) {
    const rank = rankOf(card.slug, db);
    if (rank) counts.set(rank, (counts.get(rank) ?? 0) + card.quantity);
  }
  return {
    totalF: value.f,
    formattedF: `${formatAmount(value.f)}${F_UNIT}`,
    bank: formatByRank(value.bank),
    cards: formatByRank(counts),
    shards: formatShardsByRank(value.shards),
    shardBank: formatShardsByRank(value.shardBank),
    totalCards: sumQuantity(whole),
    totalShards: sumQuantity(cards.filter((card) => card.shard)),
    rValue: hasR(value) ? `${formatAmount(value.r.value)}${R_RANK}` : null,
    rCards: value.r.count,
  };
}

export function extractProfileSlug(pathname: string): string | null {
  const match = PROFILE_PATH.exec(pathname);
  if (!match) return null;
  const raw = decodeSafely(match[1] || '').trim();
  if (!raw || RESERVED_PATHS.includes(raw)) return null;
  return raw;
}
