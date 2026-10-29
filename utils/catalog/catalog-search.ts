import { findVueApp } from '../shared/vue-app';

const CATALOG_ROUTE_NAMES: ReadonlySet<string> = new Set(['browse-manga', 'browse-anime']);
const QUERY_PARAMETER = 'query';
const SEARCH_FILTER = 'search';
const ROUTER_PROPERTY = '$router';

export interface CatalogLocation {
  name?: unknown;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
}

export interface CatalogRedirect {
  name: string;
  params: { fields: string[] };
  query: Record<string, unknown>;
}

export interface PageRouter {
  beforeEach: (guard: (destination: CatalogLocation) => CatalogRedirect | undefined) => unknown;
  afterEach: (hook: () => void) => unknown;
}

export function redirectQueryToSearch(destination: CatalogLocation): CatalogRedirect | undefined {
  const { name, params, query } = destination;
  const { [QUERY_PARAMETER]: queryText, ...otherQuery } = query;
  if (typeof name !== 'string' || !CATALOG_ROUTE_NAMES.has(name)) return undefined;
  if (typeof queryText !== 'string' || queryText.trim() === '') return undefined;
  if (Array.isArray(params.fields) && params.fields.length > 0) return undefined;
  return { name, params: { fields: [SEARCH_FILTER, queryText.trim()] }, query: otherQuery };
}

export function findRouter(pageDocument: Document): PageRouter | null {
  const router = findVueApp(pageDocument)?.config?.globalProperties?.[ROUTER_PROPERTY] as Partial<PageRouter> | null | undefined;
  return typeof router?.beforeEach === 'function' && typeof router.afterEach === 'function' ? (router as PageRouter) : null;
}

export function installCatalogRouting(pageDocument: Document): () => boolean {
  const router = findRouter(pageDocument);
  let navigationCount = 0;
  router?.afterEach(() => {
    navigationCount += 1;
  });
  router?.beforeEach(redirectQueryToSearch);
  return () => router !== null && navigationCount === 0;
}
