import { ApiError, execute, type Transport } from '../shared/graphql';
import { delayForPage, USER_CARDS_MAX_PAGES, USER_CARDS_PAGE_SIZE } from '../shared/paging';

export interface UserCard {
  slug: string;
  quantity: number;
  shard: boolean;
}

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

export interface PageState {
  cards: UserCard[];
  after: string | null;
  pages: number;
}

export interface FetchOptions {
  from?: PageState;
  onPage?: (state: PageState) => void;
  signal?: AbortSignal;
}

const startOf = (from: PageState | undefined): PageState => ({ cards: [...(from?.cards ?? [])], after: from?.after ?? null, pages: from?.pages ?? 0 });

const pageCardsOf = (connection: PageData['userCards']): UserCard[] => (connection?.edges ?? []).flatMap((edge) => toCard(edge?.node) ?? []);

function nextAfterOf(connection: PageData['userCards']): string | null {
  const info = connection?.pageInfo;
  return info?.hasNextPage && info.endCursor ? info.endCursor : null;
}

const sleepOf = (transport: Transport | undefined) => transport?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

export async function fetchUserCards(
  token: string | null,
  userId: string,
  { from, onPage, signal }: FetchOptions = {},
  transport?: Transport
): Promise<UserCard[]> {
  const start = startOf(from);
  const cards = start.cards;
  let after = start.after;
  const sleep = sleepOf(transport);
  for (let page = start.pages; page < USER_CARDS_MAX_PAGES; page++) {
    const data: PageData = await execute<PageData>(
      token,
      USER_CARDS,
      'UserCards',
      { userId, first: USER_CARDS_PAGE_SIZE, after, orderBy: ORDER },
      transport,
      signal
    );
    cards.push(...pageCardsOf(data.userCards));
    after = nextAfterOf(data.userCards);
    onPage?.({ cards: [...cards], after, pages: page + 1 });
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
