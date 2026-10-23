import { make, type Source } from 'wonka';

import type { QueryRequest } from '../../utils/shared/urql-client';

export interface Answer {
  data?: unknown;
  error?: unknown;
  stale?: boolean;
  hasNext?: boolean;
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

export const emptyCatalog: Answer = { data: { mangas: { edges: [] } } };

export const searchAnswer = (...slugs: string[]): Answer => ({
  data: {
    search: {
      edges: slugs.map((slug) => ({
        node: { id: slug, slug, originalName: slug, titles: [], mangaType: 'MANGA', mangaStatus: 'FINISHED', mangaRating: 'ALL', score: 1, cover: null },
      })),
    },
  },
});

export const rowsOf = (answer: Answer | undefined, root = 'mangas') =>
  (answer?.data as Record<string, { edges: { node: { slug: string; status: string } }[] }>)[root]?.edges ?? [];
