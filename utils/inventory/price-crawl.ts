import { ApiError, execute, type Transport } from '../shared/graphql';
import { delayForPage } from '../shared/paging';
import type { Variables } from './list-families';
import { CRAWL_OPERATION } from './price-document';

export const MAX_CRAWL_PAGES = 300;

const DEFAULT_CONNECTION_TYPE = 'UserCardConnection';
const DEFAULT_PAGE_INFO_TYPE = 'PageInfo';

export interface RowNode {
  modifier?: unknown;
  locked?: unknown;
  card?: { id?: unknown; slug?: unknown } | null;
}

export interface Row {
  node: RowNode;
}

export interface CrawledList {
  rows: Row[];
  connectionType: string;
  pageInfoType: string;
}

export interface CrawlRequest {
  text: string;
  variables: Variables;
  transport: Transport;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number | null) => void;
}

interface Connection {
  __typename?: unknown;
  totalCount?: unknown;
  edges?: ({ node?: RowNode | null } | null)[] | null;
  pageInfo?: { __typename?: unknown; hasNextPage?: unknown; endCursor?: unknown } | null;
}

interface PageData {
  userCards?: Connection | null;
}

export const slugOf = (row: Row): string | null => (typeof row.node.card?.slug === 'string' ? row.node.card.slug : null);

export const modifierOf = (modifier: unknown): number => (typeof modifier === 'number' ? modifier : 0);

const keyOf = (row: Row): string | null => (typeof row.node.card?.id === 'string' ? `${row.node.card.id}:${modifierOf(row.node.modifier)}` : null);

const typeNameOf = (candidate: unknown, fallback: string): string => (typeof candidate === 'string' && candidate !== '' ? candidate : fallback);

export async function crawlList({ text, variables, transport, signal, onProgress }: CrawlRequest): Promise<CrawledList> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  let connectionType = DEFAULT_CONNECTION_TYPE;
  let pageInfoType = DEFAULT_PAGE_INFO_TYPE;
  for (let page = 0; page < MAX_CRAWL_PAGES; page++) {
    const answer: PageData = await execute<PageData>(null, text, CRAWL_OPERATION, { ...variables, after }, transport, signal);
    const connection = answer.userCards;
    if (!connection || !Array.isArray(connection.edges)) throw new ApiError('decode');
    connectionType = typeNameOf(connection.__typename, connectionType);
    pageInfoType = typeNameOf(connection.pageInfo?.__typename, pageInfoType);
    for (const edge of connection.edges) {
      const row = edge?.node ? (edge as Row) : null;
      const key = row ? keyOf(row) : null;
      if (!row || key === null || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    onProgress?.(rows.length, typeof connection.totalCount === 'number' ? connection.totalCount : null);
    const cursor = connection.pageInfo?.endCursor;
    if (connection.pageInfo?.hasNextPage !== true || typeof cursor !== 'string') return { rows, connectionType, pageInfoType };
    after = cursor;
    const delay = delayForPage(page);
    if (delay > 0) await transport.sleep(delay);
  }
  throw new ApiError('limit');
}
