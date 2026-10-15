import { ApiError, execute, type Transport } from './graphql';

export interface UserCard {
  slug: string;
  quantity: number;
  shard: boolean;
}

export const PAGE_SIZE = 100;
export const MAX_PAGES = 300;
export const PAGE_DELAY_MS = 120;
export const FAST_PAGES = 10;
export const FAST_DELAY_MS = 0;
export const THROTTLED_DELAY_MS = 250;
export const DEEP_THROTTLE_PAGES = 50;
export const DEEP_THROTTLED_DELAY_MS = 350;
export const RATE_LIMIT_COOLDOWN_MS = 3000;
export const MAX_429_RETRIES = 3;

export const delayForPage = (page: number): number => {
  if (page < FAST_PAGES) return FAST_DELAY_MS;
  if (page < DEEP_THROTTLE_PAGES) return THROTTLED_DELAY_MS;
  return DEEP_THROTTLED_DELAY_MS;
};

const USER_CARDS =
  'query UserCards($userId: ID!, $first: Int = 20, $after: String, $orderBy: UserCardOrder!) { userCards(userId: $userId, first: $first, after: $after, orderBy: $orderBy) { pageInfo { hasNextPage endCursor } edges { node { quantity shard card { slug } } } } }';

const ORDER = { field: 'CREATED_AT', direction: 'ASC' } as const;

interface UserCardNode {
  quantity?: unknown;
  shard?: unknown;
  card?: { slug?: unknown } | null;
}

interface PageData {
  userCards: {
    pageInfo: { hasNextPage?: boolean; endCursor?: string | null } | null;
    edges: ({ node: UserCardNode | null } | null)[] | null;
  } | null;
}

function toCard(node: UserCardNode | null | undefined): UserCard | null {
  const slug = node?.card?.slug;
  const quantity = node?.quantity;
  if (typeof slug !== 'string' || !slug) return null;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null;
  return { slug, quantity, shard: node?.shard === true };
}

export async function fetchUserCards(
  token: string | null,
  userId: string,
  onProgress: (loaded: number) => void = () => undefined,
  transport?: Transport,
  signal?: AbortSignal
): Promise<UserCard[]> {
  const cards: UserCard[] = [];
  let after: string | null = null;
  const sleep = transport?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let page = 0; page < MAX_PAGES; page++) {
    if (signal?.aborted) throw new ApiError('network');
    let data: PageData | undefined;
    for (let retry = 0; retry <= MAX_429_RETRIES; retry++) {
      if (signal?.aborted) throw new ApiError('network');
      try {
        data = await execute<PageData>(token, USER_CARDS, 'UserCards', { userId, first: PAGE_SIZE, after, orderBy: ORDER }, transport, signal);
        break;
      } catch (error) {
        if (error instanceof ApiError && error.status === 429 && retry < MAX_429_RETRIES && !signal?.aborted) {
          await sleep(RATE_LIMIT_COOLDOWN_MS * (retry + 1));
          continue;
        }
        throw error;
      }
    }
    if (!data) throw new ApiError('network');
    const connection = data.userCards;
    for (const edge of connection?.edges ?? []) {
      const card = toCard(edge?.node);
      if (card) cards.push(card);
    }
    onProgress(cards.length);
    const info = connection?.pageInfo;
    after = info?.hasNextPage && info.endCursor ? info.endCursor : null;
    if (after === null) return cards;
    const delay = delayForPage(page);
    if (delay > 0) await sleep(delay);
  }
  throw new ApiError('limit');
}

type StoredCard = [string, number, 0 | 1];

const isStoredCard = (value: unknown): value is StoredCard =>
  Array.isArray(value) && value.length === 3 && typeof value[0] === 'string' && typeof value[1] === 'number' && (value[2] === 0 || value[2] === 1);

export const packCards = (cards: UserCard[]): StoredCard[] => cards.map(({ slug, quantity, shard }): StoredCard => [slug, quantity, shard ? 1 : 0]);

export const unpackCards = (list: unknown): UserCard[] =>
  Array.isArray(list) ? list.filter(isStoredCard).map(([slug, quantity, shard]) => ({ slug, quantity, shard: shard === 1 })) : [];
