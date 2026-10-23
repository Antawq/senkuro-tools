import { claimPage } from '../shared/page-claim';
import type { PageWindow } from '../shared/page-window';
import { runWhenClientFound } from '../shared/urql-client';
import { findVueApp } from '../shared/vue-app';
import { installCatalogFallback } from './catalog-fallback';

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
  return typeof router?.beforeEach === 'function' ? (router as PageRouter) : null;
}

export function installCatalogSearch(pageWindow: PageWindow): void {
  if (!claimPage(pageWindow, 'catalog-search')) return;
  runWhenClientFound(pageWindow, (client) => {
    installCatalogFallback(client);
    findRouter(pageWindow.document)?.beforeEach(redirectQueryToSearch);
  });
}
