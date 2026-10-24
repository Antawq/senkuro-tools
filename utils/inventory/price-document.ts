import { Kind, print, visit, type ASTNode, type DocumentNode, type FieldNode, type SelectionNode, type SelectionSetNode } from '@0no-co/graphql.web';

export const CRAWL_PAGE_SIZE = 100;
export const CRAWL_OPERATION = 'senkutoolsPriceRows';

const LIST_FIELD = 'userCards';
const PAGE_ARGUMENT = 'first';
const TYPENAME_FIELD = '__typename';
const TOTAL_FIELD = 'totalCount';

export interface CrawlDocument {
  text: string;
  pageSize: number;
}

const isDocument = (candidate: unknown): candidate is DocumentNode =>
  (candidate as { kind?: unknown } | null)?.kind === Kind.DOCUMENT && Array.isArray((candidate as { definitions?: unknown }).definitions);

const plainField = (name: string): FieldNode => ({ kind: Kind.FIELD, name: { kind: Kind.NAME, value: name } });

const hasPlainField = (selections: readonly SelectionNode[], name: string): boolean =>
  selections.some((selection) => selection.kind === Kind.FIELD && selection.name.value === name && !selection.alias);

function findListField(document: DocumentNode): FieldNode | null {
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    const field = definition.selectionSet.selections.find((selection) => selection.kind === Kind.FIELD && selection.name.value === LIST_FIELD);
    if (field?.kind === Kind.FIELD) return field;
  }
  return null;
}

function readPageSize(field: FieldNode): number | null {
  const argument = field.arguments?.find((candidate) => candidate.name.value === PAGE_ARGUMENT);
  const size = argument?.value.kind === Kind.INT ? Number(argument.value.value) : 0;
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

const withCrawlPaging = (field: FieldNode): FieldNode => ({
  ...field,
  arguments: field.arguments?.map((argument) =>
    argument.name.value === PAGE_ARGUMENT ? { ...argument, value: { kind: Kind.INT, value: String(CRAWL_PAGE_SIZE) } } : argument
  ),
  selectionSet: field.selectionSet && { ...field.selectionSet, selections: [...field.selectionSet.selections, plainField(TOTAL_FIELD)] },
});

const withTypename = (selectionSet: SelectionSetNode): SelectionSetNode | undefined =>
  hasPlainField(selectionSet.selections, TYPENAME_FIELD)
    ? undefined
    : { ...selectionSet, selections: [...selectionSet.selections, plainField(TYPENAME_FIELD)] };

const isRootSelection = (parent: ASTNode | readonly ASTNode[] | undefined): boolean =>
  !Array.isArray(parent) && (parent as ASTNode | undefined)?.kind === Kind.OPERATION_DEFINITION;

export function crawlDocumentOf(document: unknown): CrawlDocument | null {
  if (!isDocument(document)) return null;
  const listField = findListField(document);
  const pageSize = listField ? readPageSize(listField) : null;
  if (!listField || !pageSize) return null;
  const crawl = visit(document, {
    OperationDefinition: { enter: (node) => ({ ...node, name: { kind: Kind.NAME, value: CRAWL_OPERATION } }) },
    Field: { enter: (node) => (node === listField ? withCrawlPaging(node) : undefined) },
    SelectionSet: { enter: (node, _key, parent) => (isRootSelection(parent) ? undefined : withTypename(node)) },
  });
  return { text: print(crawl), pageSize };
}
