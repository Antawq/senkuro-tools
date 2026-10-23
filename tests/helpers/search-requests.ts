import type { QueryRequest } from '../../utils/shared/urql-client';

const argument = (name: string, argumentValue: string) => ({ kind: 'Argument', name: { value: name }, value: { kind: 'IntValue', value: argumentValue } });

export const searchDocument = (first = '10', field = 'search') => ({
  __key: 123,
  definitions: [
    { kind: 'FragmentDefinition', name: { value: 'Part' } },
    {
      kind: 'OperationDefinition',
      name: { value: 'search' },
      selectionSet: {
        selections: [
          {
            kind: 'Field',
            name: { value: field },
            arguments: [{ kind: 'Argument', name: { value: 'query' }, value: { kind: 'Variable' } }, argument('first', first)],
            selectionSet: { selections: [{ kind: 'Field', name: { value: 'edges' }, arguments: [argument('first', '5')] }] },
          },
        ],
      },
    },
  ],
});

export const request = (name: string, document = searchDocument(), key = 7): QueryRequest => ({
  key,
  variables: { query: 'naruto', type: 'MANGA' },
  query: { ...document, definitions: document.definitions.map((part) => (part.kind === 'OperationDefinition' ? { ...part, name: { value: name } } : part)) },
});

export const firstOf = (asked: QueryRequest): string[] => {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const astNode = node as { kind?: string; name?: { value?: string }; value?: { value?: string } };
    if (astNode.kind === 'Argument' && astNode.name?.value === 'first') found.push(String(astNode.value?.value));
    Object.values(astNode).forEach(walk);
  };
  walk(asked.query);
  return found;
};

export const keyOf = (asked: QueryRequest) => (asked.query as { __key?: number }).__key;
