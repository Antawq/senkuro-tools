import type { DocumentNode } from '@0no-co/graphql.web';
import { gql } from '@urql/core';

export const searchDocument = (first = 10, field = 'search', name = 'search'): DocumentNode =>
  gql(`
    fragment Part on SearchManga {
      slug
    }
    query ${name}($query: String!, $type: SearchType!) {
      ${field}(query: $query, type: $type, first: ${first}) {
        edges(first: 5) {
          node {
            ...Part
          }
        }
      }
    }
  `);

export const firstOf = (document: DocumentNode): string[] => {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const astNode = node as { kind?: string; name?: { value?: string }; value?: { value?: string } };
    if (astNode.kind === 'Argument' && astNode.name?.value === 'first') found.push(String(astNode.value?.value));
    Object.values(astNode).forEach(walk);
  };
  walk(document);
  return found;
};

export const keyOf = (document: DocumentNode) => (document as { __key?: number }).__key;
