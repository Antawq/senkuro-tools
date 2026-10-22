import { claimPage } from '../shared/page-claim';
import { operationName, whenClient, type QueryClient, type QueryRequest } from '../shared/urql-client';

export const SEARCH_OPERATION = 'search';
export const SEARCH_PAGE_SIZE = 30;

const PAGE_ARGUMENT = 'first';
const INT_LITERAL = 'IntValue';
const DOCUMENT_KEY = '__key';
const KEY_MIX = 0x5bd1e995;
const KEY_STRIDE = 31;

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

export function widenSearches(client: QueryClient, size = SEARCH_PAGE_SIZE): boolean {
  if (patched.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => original(widenSearch(request, size), options);
  } catch {
    return false;
  }
  patched.add(client);
  return true;
}

export function installSearchSize(win: Window & typeof globalThis): void {
  if (!claimPage(win, 'search-size')) return;
  whenClient(win, (client) => void widenSearches(client));
}
