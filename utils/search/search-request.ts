import type { Sink } from 'wonka';

import { claimPage } from '../shared/page-claim';
import type { PageWindow } from '../shared/page-window';
import { operationName, whenClient, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { tapSource, type SourceResult } from '../shared/urql-source';
import { SEARCH_EVENT, type SearchSignal } from './search-signal';

const SEARCH_OPERATION = 'search';
export const SEARCH_PAGE_SIZE = 30;

const PAGE_ARGUMENT = 'first';
const INT_LITERAL = 'IntValue';
const DOCUMENT_KEY = '__key';
const KEY_MIX = 0x5bd1e995;
const KEY_STRIDE = 31;

type Publish = (signal: SearchSignal) => void;

interface AstNode {
  kind?: string;
  name?: { value?: string };
  value?: { kind?: string; value?: string };
  arguments?: AstNode[];
  selections?: AstNode[];
  selectionSet?: AstNode;
  definitions?: AstNode[];
}

const widened = new WeakMap<object, unknown>();
const patched = new WeakSet<QueryClient>();

const isPageArgument = (node: AstNode, size: number): boolean =>
  node.kind === 'Argument' && node.name?.value === PAGE_ARGUMENT && node.value?.kind === INT_LITERAL && Number(node.value.value) < size;

function resize(node: AstNode | undefined, size: number): boolean {
  if (!node) return false;
  let changed = false;
  const isSearchField = node.kind === 'Field' && node.name?.value === SEARCH_OPERATION;
  for (const argument of isSearchField ? (node.arguments ?? []) : []) {
    if (!isPageArgument(argument, size) || !argument.value) continue;
    argument.value.value = String(size);
    changed = true;
  }
  const children = [...(node.definitions ?? []), ...(node.selections ?? []), ...(node.selectionSet ? [node.selectionSet] : [])];
  return children.map((child) => resize(child, size)).some(Boolean) || changed;
}

function widerDocument(document: object, size: number): unknown {
  if (widened.has(document)) return widened.get(document);
  const copy = structuredClone(document) as AstNode & Record<string, unknown>;
  Reflect.deleteProperty(copy, DOCUMENT_KEY);
  const result = resize(copy, size) ? copy : null;
  widened.set(document, result);
  return result;
}

const keyFor = (key: number, size: number): number => (Math.imul(key ^ KEY_MIX, KEY_STRIDE) + size) | 0;

export function widenSearch(request: QueryRequest, size = SEARCH_PAGE_SIZE): QueryRequest {
  if (operationName(request) !== SEARCH_OPERATION || typeof request.key !== 'number' || !request.query) return request;
  const query = widerDocument(request.query, size);
  return query ? { ...request, key: keyFor(request.key, size), query: query } : request;
}

function announce(source: unknown, request: QueryRequest, publish: Publish): unknown {
  const { query, type } = request.variables ?? {};
  if (typeof source !== 'function' || typeof query !== 'string' || typeof type !== 'string') return source;
  let open = 0;
  const finish = () => {
    if (open === 0) return;
    open -= 1;
    publish({ phase: 'done', query, type });
  };
  return tapSource(source as (sink: Sink<SourceResult>) => void, {
    start: () => {
      open += 1;
      publish({ phase: 'start', query, type });
    },
    settled: finish,
    end: finish,
  });
}

export function widenSearches(client: QueryClient, publish: Publish = () => undefined, size = SEARCH_PAGE_SIZE): boolean {
  if (patched.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      const source = original(widenSearch(request, size), options);
      return operationName(request) === SEARCH_OPERATION ? announce(source, request, publish) : source;
    };
  } catch {
    return false;
  }
  patched.add(client);
  return true;
}

export function installSearchRequest(win: PageWindow): void {
  if (!claimPage(win, 'search-request')) return;
  const publish: Publish = (signal) => win.document.dispatchEvent(new win.CustomEvent(SEARCH_EVENT, { detail: JSON.stringify(signal) }));
  whenClient(win, (client) => void widenSearches(client, publish));
}
