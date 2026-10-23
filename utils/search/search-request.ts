import type { Sink } from 'wonka';

import { claimPage } from '../shared/page-claim';
import type { PageWindow } from '../shared/page-window';
import { operationName, runWhenClientFound, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { tapSource, type SourceResult } from '../shared/urql-source';
import { SEARCH_EVENT, type SearchSignal } from './search-signal';

const SEARCH_OPERATION = 'search';
export const SEARCH_PAGE_SIZE = 30;

const PAGE_ARGUMENT = 'first';
const INT_LITERAL = 'IntValue';
const DOCUMENT_KEY = '__key';
const KEY_HASH_MIX = 0x5bd1e995;
const KEY_HASH_STRIDE = 31;

type Publish = (signal: SearchSignal) => void;

interface SearchAnswer extends SourceResult {
  data?: { search?: { edges?: { node?: { slug?: unknown } }[] } | null };
}

const firstSlugOf = (answer: SearchAnswer): string | null => {
  const slug = answer.data?.search?.edges?.[0]?.node?.slug;
  return typeof slug === 'string' ? slug : null;
};

interface AstNode {
  kind?: string;
  name?: { value?: string };
  value?: { kind?: string; value?: string };
  arguments?: AstNode[];
  selections?: AstNode[];
  selectionSet?: AstNode;
  definitions?: AstNode[];
}

const widenedByQueryDocument = new WeakMap<object, unknown>();
const patchedClients = new WeakSet<QueryClient>();

const isPageArgument = (node: AstNode, pageSize: number): boolean =>
  node.kind === 'Argument' && node.name?.value === PAGE_ARGUMENT && node.value?.kind === INT_LITERAL && Number(node.value.value) < pageSize;

function setPageSizeInQuery(node: AstNode | undefined, pageSize: number): boolean {
  if (!node) return false;
  let didChange = false;
  const isSearchField = node.kind === 'Field' && node.name?.value === SEARCH_OPERATION;
  for (const argument of isSearchField ? (node.arguments ?? []) : []) {
    if (!isPageArgument(argument, pageSize) || !argument.value) continue;
    argument.value.value = String(pageSize);
    didChange = true;
  }
  const children = [...(node.definitions ?? []), ...(node.selections ?? []), ...(node.selectionSet ? [node.selectionSet] : [])];
  return children.map((child) => setPageSizeInQuery(child, pageSize)).some(Boolean) || didChange;
}

function widenQueryDocument(queryDocument: object, pageSize: number): unknown {
  if (widenedByQueryDocument.has(queryDocument)) return widenedByQueryDocument.get(queryDocument);
  const copy = structuredClone(queryDocument) as AstNode & Record<string, unknown>;
  Reflect.deleteProperty(copy, DOCUMENT_KEY);
  const widenedQuery = setPageSizeInQuery(copy, pageSize) ? copy : null;
  widenedByQueryDocument.set(queryDocument, widenedQuery);
  return widenedQuery;
}

const keyFor = (key: number, pageSize: number): number => (Math.imul(key ^ KEY_HASH_MIX, KEY_HASH_STRIDE) + pageSize) | 0;

export function widenSearchRequest(request: QueryRequest, pageSize = SEARCH_PAGE_SIZE): QueryRequest {
  if (operationName(request) !== SEARCH_OPERATION || typeof request.key !== 'number' || !request.query) return request;
  const query = widenQueryDocument(request.query, pageSize);
  return query ? { ...request, key: keyFor(request.key, pageSize), query: query } : request;
}

function publishSearchPhases(source: unknown, request: QueryRequest, publish: Publish): unknown {
  const { query, type } = request.variables ?? {};
  if (typeof source !== 'function' || typeof query !== 'string' || typeof type !== 'string') return source;
  let openCount = 0;
  const finish = (settledAnswer?: SearchAnswer) => {
    if (openCount === 0) return;
    openCount -= 1;
    publish(settledAnswer ? { phase: 'done', query, type, settled: true, firstSlug: firstSlugOf(settledAnswer) } : { phase: 'done', query, type });
  };
  return tapSource(source as (sink: Sink<SearchAnswer>) => void, {
    onStart: () => {
      openCount += 1;
      publish({ phase: 'start', query, type });
    },
    onSettled: finish,
    onEnd: () => finish(),
  });
}

export function installSearchWidening(client: QueryClient, publish: Publish = () => undefined, pageSize = SEARCH_PAGE_SIZE): boolean {
  if (patchedClients.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      const source = original(widenSearchRequest(request, pageSize), options);
      return operationName(request) === SEARCH_OPERATION ? publishSearchPhases(source, request, publish) : source;
    };
  } catch {
    return false;
  }
  patchedClients.add(client);
  return true;
}

export function installSearchRequest(pageWindow: PageWindow): void {
  if (!claimPage(pageWindow, 'search-request')) return;
  const publish: Publish = (signal) => pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(SEARCH_EVENT, { detail: JSON.stringify(signal) }));
  runWhenClientFound(pageWindow, (client) => void installSearchWidening(client, publish));
}
