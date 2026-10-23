import { delayForPage } from '../shared/paging';
import type { QueryClient } from '../shared/urql-client';
import { familyIdOf, type PageRequest } from './list-families';

export const MAX_LOAD_PAGES = 300;

const READ_POLICY = 'cache-first';
const LOAD_POLICY = 'network-only';

export interface LoadEnv {
  client: QueryClient;
  latest: () => PageRequest | null;
  sleep: (ms: number) => Promise<void>;
}

interface PageInfo {
  hasNextPage?: unknown;
  endCursor?: unknown;
}

interface ListResult {
  data?: { userCards?: { pageInfo?: PageInfo | null } | null } | null;
  error?: unknown;
}

async function askFor(env: LoadEnv, page: PageRequest, after: unknown, policy: string): Promise<PageInfo | null> {
  const variables = after === undefined ? page.variables : { ...page.variables, after };
  const result = (await env.client.query(page.document, variables, { ...page.options, requestPolicy: policy }).toPromise()) as ListResult | undefined;
  return result?.error ? null : (result?.data?.userCards?.pageInfo ?? null);
}

const stillTheSameList = (env: LoadEnv, family: string): boolean => {
  const now = env.latest();
  return now !== null && familyIdOf(now.variables) === family;
};

async function loadAll(env: LoadEnv, page: PageRequest): Promise<boolean> {
  const family = familyIdOf(page.variables);
  let info = await askFor(env, page, undefined, READ_POLICY);
  for (let loaded = 0; info?.hasNextPage === true; loaded++) {
    if (typeof info.endCursor !== 'string' || loaded >= MAX_LOAD_PAGES || !stillTheSameList(env, family)) return false;
    if (loaded > 0) await env.sleep(delayForPage(loaded - 1));
    info = await askFor(env, page, info.endCursor, LOAD_POLICY);
  }
  return info !== null;
}

export async function loadRest(env: LoadEnv): Promise<boolean> {
  const page = env.latest();
  if (!page) return false;
  try {
    return await loadAll(env, page);
  } catch {
    return false;
  }
}
