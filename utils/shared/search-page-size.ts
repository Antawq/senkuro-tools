import { operationName, type QueryRequest } from './urql-client';

export const SEARCH_OPERATION = 'search';
const PAGE_ARGUMENT = 'first';
const INT_LITERAL = 'IntValue';
const DOCUMENT_KEY = '__key';

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

export function widenSearchRequest(request: QueryRequest, pageSize: number): QueryRequest {
  if (operationName(request) !== SEARCH_OPERATION || !request.query) return request;
  const query = widenQueryDocument(request.query, pageSize);
  return query ? { ...request, query } : request;
}
