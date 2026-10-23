import type { LoadOutcome } from '../shared/list-signal';
import { delayForPage } from '../shared/paging';
import type { QueryClient } from '../shared/urql-client';
import { familyIdOf, type PageRequest } from './list-families';

export const MAX_LOAD_PAGES = 300;

const READ_POLICY = 'cache-first';
const LOAD_POLICY = 'network-only';

export interface LoadHost {
  client: QueryClient;
  latestPage: () => PageRequest | null;
  sleep: (delayMs: number) => Promise<void>;
}

interface PageInfo {
  hasNextPage?: unknown;
  endCursor?: unknown;
}

interface ListResult {
  data?: { userCards?: { pageInfo?: PageInfo | null } | null } | null;
  error?: unknown;
}

async function fetchPageInfo(host: LoadHost, page: PageRequest, after: unknown, policy: string): Promise<PageInfo | null> {
  const variables = after === undefined ? page.variables : { ...page.variables, after };
  const queryResult = (await host.client.query(page.document, variables, { ...page.options, requestPolicy: policy }).toPromise()) as ListResult | undefined;
  return queryResult?.error ? null : (queryResult?.data?.userCards?.pageInfo ?? null);
}

const isLatestList = (host: LoadHost, familyId: string): boolean => {
  const currentPage = host.latestPage();
  return currentPage !== null && familyIdOf(currentPage.variables) === familyId;
};

async function loadFollowingPages(host: LoadHost, page: PageRequest): Promise<LoadOutcome> {
  const familyId = familyIdOf(page.variables);
  let pageInfo = await fetchPageInfo(host, page, undefined, READ_POLICY);
  for (let loadedCount = 0; pageInfo?.hasNextPage === true; loadedCount++) {
    if (!isLatestList(host, familyId)) return 'moved';
    if (typeof pageInfo.endCursor !== 'string' || loadedCount >= MAX_LOAD_PAGES) return 'partial';
    if (loadedCount > 0) await host.sleep(delayForPage(loadedCount - 1));
    pageInfo = await fetchPageInfo(host, page, pageInfo.endCursor, LOAD_POLICY);
  }
  return pageInfo === null ? 'partial' : 'complete';
}

export async function loadRest(host: LoadHost): Promise<LoadOutcome> {
  const page = host.latestPage();
  if (!page) return 'partial';
  try {
    return await loadFollowingPages(host, page);
  } catch {
    return 'partial';
  }
}
