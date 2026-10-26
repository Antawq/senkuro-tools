import { describe, expect, it } from 'vitest';

import { parse } from '@0no-co/graphql.web';

import { CRAWL_OPERATION, crawlDocumentOf } from '../utils/inventory/price-document';
import { USER_CARDS_PAGE_SIZE } from '../utils/shared/paging';

const LIST = `
  query fetchUserCards($after: String, $userId: ID!, $orderField: UserCardOrderField = CREATED_AT) {
    userCards(first: 20, after: $after, userId: $userId, orderBy: { field: $orderField, direction: DESC }) {
      edges { node { ...Row } }
      pageInfo { hasNextPage endCursor }
    }
  }
  fragment Row on UserCard { quantity modifier card { id slug } }
`;

const text = (source: string): string => crawlDocumentOf(parse(source))?.text ?? '';

describe('crawlDocumentOf', () => {
  it('asks for the biggest page, the total and a name of its own, and reports the page size the site uses', () => {
    const crawl = crawlDocumentOf(parse(LIST));
    expect(crawl?.pageSize).toBe(20);
    expect(crawl?.text).toContain(`first: ${USER_CARDS_PAGE_SIZE}`);
    expect(crawl?.text).toContain(`query ${CRAWL_OPERATION}(`);
    expect(crawl?.text).toContain('totalCount');
  });

  it('keeps the variables, the ordering and the fragments of the site document', () => {
    const crawl = text(LIST);
    expect(crawl).toContain('$after: String');
    expect(crawl).toContain('$orderField: UserCardOrderField = CREATED_AT');
    expect(crawl).toContain('orderBy: {field: $orderField, direction: DESC}');
    expect(crawl).toContain('fragment Row on UserCard');
  });

  it('asks for the type name in every selection below the root, because the cache needs it to store the rows', () => {
    const crawl = parse(text(LIST));
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const selections = (node as { selections?: { name?: { value: string } }[] }).selections;
      if (selections) names.push(selections.map((selection) => selection.name?.value ?? '...').join());
      Object.values(node).forEach(walk);
    };
    walk(crawl);
    const below = names.slice(1);
    expect(names[0]).not.toContain('__typename');
    expect(below.length).toBeGreaterThan(3);
    expect(below.every((fields) => fields.split(',').includes('__typename') || fields === '...')).toBe(true);
  });

  it('does not add the type name twice when the site document already has it', () => {
    const crawl = text(`query fetchUserCards { userCards(first: 5) { __typename edges { __typename node { id } } } }`);
    expect(crawl.match(/__typename/g)).toHaveLength(3);
  });

  it('prints something the server can read back', () => {
    const crawl = crawlDocumentOf(parse(LIST));
    expect(() => parse(crawl?.text ?? '')).not.toThrow();
  });

  it('says nothing when the document is not the list document it knows', () => {
    expect(crawlDocumentOf(null)).toBeNull();
    expect(crawlDocumentOf({ kind: 'Document' })).toBeNull();
    expect(crawlDocumentOf(parse('query other { viewer { id } }'))).toBeNull();
    expect(crawlDocumentOf(parse('query fetchUserCards($first: Int) { userCards(first: $first) { edges { node { id } } } }'))).toBeNull();
    expect(crawlDocumentOf(parse('query fetchUserCards { userCards { edges { node { id } } } }'))).toBeNull();
  });
});
