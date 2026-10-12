import { type Database } from './database';
import { ApiError, executePersisted, type Transport } from './graphql';
import { formatAmount, formatByRank, formatShardsByRank, hasR, valueSide, type SideValue } from './trade-value';

export interface ProfileCard {
  slug: string;
  quantity: number;
  shard: boolean;
}

export interface ProfileValueSummary {
  totalF: number;
  formattedF: string;
  bank: string[];
  cards: string[];
  shards: string[];
  totalCards: number;
  totalShards: number;
  rValue: string | null;
  rCards: number;
}

export const MAX_PAGES = 300;

export const PROFILE_HASH = '4bef9abf7c5ad00af59085a24e9c52ad3f095d8adc1e9251b65c7eece2bb07e6';
export const INVENTORY_HASH = 'e426e266f581825cf223ad2d30e133e95404113093576629481fdda992d47016';

interface UserData {
  user?: { id?: string; slug?: string; name?: string } | null;
}

interface UserCardNode {
  quantity?: unknown;
  shard?: unknown;
  card?: { slug?: unknown } | null;
}

interface PageData {
  userCards?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
    edges?: ({ node?: UserCardNode | null } | null)[] | null;
  } | null;
}

function toCard(node: UserCardNode | null | undefined): ProfileCard | null {
  const slug = node?.card?.slug;
  const quantity = node?.quantity;
  if (typeof slug !== 'string' || !slug) return null;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null;
  return { slug, quantity, shard: node?.shard === true };
}

export async function fetchProfileUser(slug: string, transport?: Transport): Promise<{ id: string; name: string } | null> {
  const data = await executePersisted<UserData>('fetchUser', { slug }, PROFILE_HASH, undefined, transport);
  const user = data?.user;
  if (!user?.id) return null;
  return { id: String(user.id), name: user.name || slug };
}

export async function fetchProfileCards(
  userId: string,
  onProgress?: (loaded: number) => void,
  transport?: Transport
): Promise<ProfileCard[]> {
  const cards: ProfileCard[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const variables: Record<string, unknown> = {
      userId,
      orderDirection: 'DESC',
      orderField: 'CREATED_AT',
    };
    if (after) variables.after = after;
    const data: PageData = await executePersisted<PageData>('fetchUserCards', variables, INVENTORY_HASH, undefined, transport);
    const connection = data?.userCards;
    for (const edge of connection?.edges ?? []) {
      const card = toCard(edge?.node);
      if (card) cards.push(card);
    }
    onProgress?.(cards.length);
    const info = connection?.pageInfo;
    after = info?.hasNextPage && info.endCursor ? info.endCursor : null;
    if (after === null) return cards;
  }
  throw new ApiError('limit');
}

export function calculateProfileValue(cards: ProfileCard[], db: Database, commission: boolean): ProfileValueSummary {
  const sideValue: SideValue = valueSide({ cards, hidden: 0 }, db, commission);
  const wholeCards = cards.filter((c) => !c.shard);
  const shardCards = cards.filter((c) => c.shard);

  const totalCards = wholeCards.reduce((acc, c) => acc + c.quantity, 0);
  const totalShards = shardCards.reduce((acc, c) => acc + c.quantity, 0);

  return {
    totalF: sideValue.f,
    formattedF: `${formatAmount(sideValue.f)}F`,
    bank: formatByRank(sideValue.bank),
    cards: formatByRank(sideValue.count),
    shards: formatShardsByRank(sideValue.shards),
    totalCards,
    totalShards,
    rValue: hasR(sideValue) ? `${formatAmount(sideValue.r.value)}R` : null,
    rCards: sideValue.r.count,
  };
}

export function extractProfileSlug(pathname: string): string | null {
  const match = pathname.match(/^\/users\/([^/?#]+)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1] || '').trim();
  if (!raw || ['settings', 'notifications', 'card-trades'].includes(raw)) return null;
  return raw;
}
