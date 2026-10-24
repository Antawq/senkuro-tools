import { make, type Source } from 'wonka';

import type { QueryRequest } from '../../utils/shared/urql-client';

export interface Answer {
  data?: unknown;
  error?: unknown;
  stale?: boolean;
  hasNext?: boolean;
}

export interface QueryCall {
  document: string;
  variables: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}

const NO_FILTERS = { after: null, status: { include: [], exclude: [] }, releasedOn: {}, orderField: 'POPULARITY_SCORE', orderDirection: 'DESC' };

export const catalogRequest = (operation: string, variables: Record<string, unknown> = {}): QueryRequest => ({
  key: 99,
  variables: { ...NO_FILTERS, search: 'НАРУТО', ...variables },
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: operation } }] },
});

export const sourceOf = (answers: Answer[]): Source<Answer> =>
  make<Answer>((observer) => {
    answers.forEach((answer) => observer.next(answer));
    observer.complete();
    return () => undefined;
  });

export const promiseOf = (answer: Answer) => ({ toPromise: () => Promise.resolve(answer) });

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export const emptyCatalog: Answer = { data: { mangas: { edges: [] } } };

export const searchRow = (slug: string, fields: Record<string, unknown> = {}) => ({
  id: slug,
  slug,
  originalName: slug,
  titles: [],
  mangaType: 'MANGA',
  mangaStatus: 'FINISHED',
  mangaRating: 'ALL',
  score: 1,
  cover: null,
  ...fields,
});

export const searchPage = (slugs: string[], totalCount = slugs.length, endCursor: string | null = null): Answer => ({
  data: {
    search: {
      totalCount,
      pageInfo: { hasNextPage: endCursor !== null, endCursor },
      edges: slugs.map((slug) => ({ node: searchRow(slug) })),
    },
  },
});

export const searchAnswer = (...slugs: string[]): Answer => searchPage(slugs);

export const factsAnswer = (facts: Record<string, Record<string, unknown>>): Answer => ({
  data: Object.fromEntries(Object.entries(facts).map(([slug, fields], index) => [`a${index}`, { id: slug, slug, ...fields }])),
});

export const rowsOf = (answer: Answer | undefined, root = 'mangas') =>
  (answer?.data as Record<string, { edges: { node: { slug: string; status: string } }[] }>)[root]?.edges ?? [];
