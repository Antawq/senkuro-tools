import { findVueApp } from '../shared/vue-app';

const CATALOG_ROUTE_NAMES: ReadonlySet<string> = new Set(['browse-manga', 'browse-anime']);
const LIST_ROUTE_NAMES: ReadonlySet<string> = new Set(['browse-manga', 'browse-anime', 'browse-cards', 'browse-decks']);
const QUERY_PARAMETER = 'query';
const SEARCH_FILTER = 'search';
const ROUTER_PROPERTY = '$router';

export interface CatalogLocation {
  name?: unknown;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  hash?: unknown;
}

export interface CatalogReplay extends CatalogLocation {
  force: true;
}

export interface CatalogRedirect {
  name: string;
  params: { fields: string[] };
  query: Record<string, unknown>;
}

export interface PageRouter {
  beforeEach: (guard: (destination: CatalogLocation, origin: CatalogLocation) => CatalogRedirect | undefined) => unknown;
  afterEach: (hook: (destination: CatalogLocation, origin: CatalogLocation, failure?: unknown) => void) => unknown;
  replace: (target: CatalogReplay) => Promise<unknown>;
}

const fieldsOf = ({ params }: CatalogLocation): unknown[] => (Array.isArray(params.fields) ? params.fields : []);

const hasSameFields = (destination: CatalogLocation, origin: CatalogLocation): boolean =>
  JSON.stringify(fieldsOf(origin)) === JSON.stringify(fieldsOf(destination));

const isCarriedOver = (destination: CatalogLocation, origin?: CatalogLocation): boolean =>
  origin !== undefined && origin.name === destination.name && hasSameFields(destination, origin);

const hasOwnFilters = (destination: CatalogLocation, origin?: CatalogLocation): boolean =>
  fieldsOf(destination).length > 0 && !isCarriedOver(destination, origin);

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
  return typeof router?.beforeEach === 'function' && typeof router.afterEach === 'function' && typeof router.replace === 'function'
    ? (router as PageRouter)
    : null;
}

const isListChange = (destination: CatalogLocation, origin: CatalogLocation): boolean =>
  typeof destination.name === 'string' && LIST_ROUTE_NAMES.has(destination.name) && destination.name === origin.name && !hasSameFields(destination, origin);

export interface CatalogRouting {
  isBeforeFirstNavigation: () => boolean;
  noteListRequest: () => void;
}

function replay(router: PageRouter, destination: CatalogLocation): void {
  const { name, params, query, hash } = destination;
  router
    .replace({ name, params: { ...params, fields: fieldsOf(destination) }, query, hash, force: true })
    .catch((error: unknown) => console.error('SenkuTools: catalog replay failed', error));
}

function replayUnreadListChanges(router: PageRouter): () => void {
  let listRequestCount = 0;
  router.afterEach((destination, origin, failure) =>
    queueMicrotask(() => {
      if (!failure && listRequestCount === 0 && isListChange(destination, origin)) replay(router, destination);
      listRequestCount = 0;
    })
  );
  return () => {
    listRequestCount += 1;
  };
}

export function installCatalogRouting(pageDocument: Document): CatalogRouting {
  const router = findRouter(pageDocument);
  let navigationCount = 0;
  router?.afterEach(() => {
    navigationCount += 1;
  });
  router?.beforeEach(redirectQueryToSearch);
  const noteListRequest = router ? replayUnreadListChanges(router) : () => undefined;
  return { isBeforeFirstNavigation: () => router !== null && navigationCount === 0, noteListRequest };
}
