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
  beforeEach: (guard: (destination: CatalogLocation, origin: CatalogLocation) => CatalogRedirect | false | undefined) => unknown;
  afterEach: (hook: () => void) => unknown;
  resolve?: (target: CatalogRedirect) => { href: string };
}

const isCarriedOver = (destination: CatalogLocation, origin?: CatalogLocation): boolean =>
  origin !== undefined && origin.name === destination.name && JSON.stringify(origin.params.fields) === JSON.stringify(destination.params.fields);

const hasOwnFilters = (destination: CatalogLocation, origin?: CatalogLocation): boolean =>
  Array.isArray(destination.params.fields) && destination.params.fields.length > 0 && !isCarriedOver(destination, origin);

export function redirectQueryToSearch(destination: CatalogLocation, origin?: CatalogLocation): CatalogRedirect | undefined {
  const { name, query } = destination;
  const { [QUERY_PARAMETER]: queryText, ...otherQuery } = query;
  if (typeof name !== 'string' || !CATALOG_ROUTE_NAMES.has(name)) return undefined;
  if (typeof queryText !== 'string' || queryText.trim() === '') return undefined;
  if (hasOwnFilters(destination, origin)) return undefined;
  return { name, params: { fields: [SEARCH_FILTER, queryText.trim()] }, query: otherQuery };
}

export function findRouter(pageDocument: Document): PageRouter | null {
  const router = findVueApp(pageDocument)?.config?.globalProperties?.[ROUTER_PROPERTY] as Partial<PageRouter> | null | undefined;
  return typeof router?.beforeEach === 'function' && typeof router.afterEach === 'function' ? (router as PageRouter) : null;
}

const hasSearchFilter = ({ params }: CatalogLocation): boolean =>
  Array.isArray(params.fields) && params.fields.some((field, index) => index % 2 === 0 && field === SEARCH_FILTER);

function routeCatalogQuery(router: PageRouter, pageDocument: Document) {
  return (destination: CatalogLocation, origin: CatalogLocation): CatalogRedirect | false | undefined => {
    const redirect = redirectQueryToSearch(destination, origin);
    if (!redirect || origin.name !== redirect.name || !hasSearchFilter(origin) || typeof router.resolve !== 'function') return redirect;
    if (JSON.stringify(origin.params.fields) === JSON.stringify(redirect.params.fields)) return redirect;
    pageDocument.location.assign(router.resolve(redirect).href);
    return false;
  };
}

export function installCatalogRouting(pageDocument: Document): () => boolean {
  const router = findRouter(pageDocument);
  let navigationCount = 0;
  router?.afterEach(() => {
    navigationCount += 1;
  });
  router?.beforeEach(routeCatalogQuery(router, pageDocument));
  return () => router !== null && navigationCount === 0;
}
