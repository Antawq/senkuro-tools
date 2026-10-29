import type { DocumentNode } from '@0no-co/graphql.web';
import { getOperationName } from '@urql/core';

export const SEARCH_OPERATION = 'search';
const PAGE_ARGUMENT = 'first';
const INT_LITERAL = 'IntValue';
const DOCUMENT_KEY = '__key';

interface AstNode {
  kind?: string;
  name?: { value?: string };
  value?: { kind?: string; value?: string };
  arguments?: readonly AstNode[];
  selections?: readonly AstNode[];
  selectionSet?: AstNode;
  definitions?: readonly AstNode[];
}

const widenedByQueryDocument = new WeakMap<DocumentNode, DocumentNode | null>();

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

export function widenSearchQuery(query: DocumentNode, pageSize: number): DocumentNode | null {
  if (getOperationName(query) !== SEARCH_OPERATION) return null;
  const known = widenedByQueryDocument.get(query);
  if (known !== undefined) return known;
  const copy = structuredClone(query);
  Reflect.deleteProperty(copy, DOCUMENT_KEY);
  const widenedQuery = setPageSizeInQuery(copy, pageSize) ? copy : null;
  widenedByQueryDocument.set(query, widenedQuery);
  return widenedQuery;
}
