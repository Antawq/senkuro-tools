import { ApiError, execute, type Transport } from './graphql';

export interface AccountCard {
  slug: string;
  quantity: number;
  shard: boolean;
}

export const PAGE_SIZE = 100;
export const MAX_PAGES = 300;

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

function toCard(node: UserCardNode | null | undefined): AccountCard | null {
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
  transport?: Transport
): Promise<AccountCard[]> {
  const cards: AccountCard[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: PageData = await execute<PageData>(token, USER_CARDS, 'UserCards', { userId, first: PAGE_SIZE, after, orderBy: ORDER }, transport);
    const connection = data.userCards;
    for (const edge of connection?.edges ?? []) {
      const card = toCard(edge?.node);
      if (card) cards.push(card);
    }
    onProgress(cards.length);
    const info = connection?.pageInfo;
    after = info?.hasNextPage && info.endCursor ? info.endCursor : null;
    if (after === null) return cards;
  }
  throw new ApiError('limit');
}
