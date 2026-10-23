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
const KEY_HASH_MIX = 0x5bd1e995;
const KEY_HASH_STRIDE = 31;

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

function setPageSizeInQuery(node: AstNode | undefined, size: number): boolean {
  if (!node) return false;
  let changed = false;
  const isSearchField = node.kind === 'Field' && node.name?.value === SEARCH_OPERATION;
  for (const argument of isSearchField ? (node.arguments ?? []) : []) {
    if (!isPageArgument(argument, size) || !argument.value) continue;
    argument.value.value = String(size);
    changed = true;
  }
  const children = [...(node.definitions ?? []), ...(node.selections ?? []), ...(node.selectionSet ? [node.selectionSet] : [])];
  return children.map((child) => setPageSizeInQuery(child, size)).some(Boolean) || changed;
}

function widenQueryDocument(document: object, size: number): unknown {
  if (widened.has(document)) return widened.get(document);
  const copy = structuredClone(document) as AstNode & Record<string, unknown>;
  Reflect.deleteProperty(copy, DOCUMENT_KEY);
  const result = setPageSizeInQuery(copy, size) ? copy : null;
  widened.set(document, result);
  return result;
}

const keyFor = (key: number, size: number): number => (Math.imul(key ^ KEY_HASH_MIX, KEY_HASH_STRIDE) + size) | 0;

export function widenSearchRequest(request: QueryRequest, size = SEARCH_PAGE_SIZE): QueryRequest {
  if (operationName(request) !== SEARCH_OPERATION || typeof request.key !== 'number' || !request.query) return request;
  const query = widenQueryDocument(request.query, size);
  return query ? { ...request, key: keyFor(request.key, size), query: query } : request;
}

function publishSearchPhases(source: unknown, request: QueryRequest, publish: Publish): unknown {
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

export function installSearchWidening(client: QueryClient, publish: Publish = () => undefined, size = SEARCH_PAGE_SIZE): boolean {
  if (patched.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      const source = original(widenSearchRequest(request, size), options);
      return operationName(request) === SEARCH_OPERATION ? publishSearchPhases(source, request, publish) : source;
    };
  } catch {
    return false;
  }
  patched.add(client);
  return true;
}

export function installSearchRequest(pageWindow: PageWindow): void {
  if (!claimPage(pageWindow, 'search-request')) return;
  const publish: Publish = (signal) => pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(SEARCH_EVENT, { detail: JSON.stringify(signal) }));
  whenClient(pageWindow, (client) => void installSearchWidening(client, publish));
}
