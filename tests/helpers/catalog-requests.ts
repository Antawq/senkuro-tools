import { print, type DocumentNode } from '@0no-co/graphql.web';
import { Client, getOperationName, gql, makeErrorResult, makeResult, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { filter, fromArray, make, map, mergeMap, pipe, type Source } from 'wonka';

import { catalogFallbackExchange } from '../../utils/catalog/catalog-fallback';
import { delegateExchange } from '../../utils/shared/delegate-exchange';

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

export interface CatalogRequest {
  query: DocumentNode;
  variables: Record<string, unknown>;
}

export const catalogRequest = (operation: string, variables: Record<string, unknown> = {}): CatalogRequest => ({
  query: gql(`query ${operation}($search: String) { list(search: $search) { edges { node { slug } } } }`),
  variables: { ...NO_FILTERS, search: 'НАРУТО', ...variables },
});

const SITE_URL = 'https://api.senkuro.me/graphql';
const OWN_OPERATIONS: ReadonlySet<string | undefined> = new Set(['catalogSearch', 'catalogRowFacts']);

export const resultOf = (operation: Operation, answer: Answer): OperationResult => {
  const result = answer.error ? makeErrorResult(operation, answer.error as Error) : makeResult(operation, { data: answer.data ?? null });
  return { ...result, stale: answer.stale === true };
};

export const answerOf = (result: OperationResult): Answer => ({
  data: result.data,
  ...(result.error ? { error: result.error } : {}),
  ...(result.stale ? { stale: true } : {}),
});

export interface CatalogSite {
  catalogAnswers: () => Source<Answer>;
  answerOwn: (call: QueryCall) => Source<Answer>;
}

export const answersOnce = (answers: Answer[]): Source<Answer> => fromArray(answers);

export const answerLater = (waiting: (() => void)[], answer: Answer): Source<Answer> =>
  make<Answer>((observer) => {
    waiting.push(() => observer.next(answer));
    return () => undefined;
  });

export function createCatalogSiteClient({ catalogAnswers, answerOwn }: CatalogSite) {
  const calls: QueryCall[] = [];
  const site: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation: Operation) => operation.kind !== 'teardown'),
      mergeMap((operation: Operation) => {
        const isOwn = OWN_OPERATIONS.has(getOperationName(operation.query));
        const call = { document: print(operation.query), variables: operation.variables as Record<string, unknown>, options: operation.context };
        if (isOwn) calls.push(call);
        return pipe(
          isOwn ? answerOwn(call) : catalogAnswers(),
          map((answer) => resultOf(operation, answer))
        );
      })
    );
  return { siteClient: new Client({ url: SITE_URL, exchanges: [site] }), calls };
}

export function createCatalogClients(site: CatalogSite, isHydrating: () => boolean = () => false) {
  const { siteClient, calls } = createCatalogSiteClient(site);
  const client = new Client({ url: SITE_URL, exchanges: [catalogFallbackExchange(isHydrating), delegateExchange(siteClient)] });
  return { client, calls };
}

export async function answersFor(client: Client, asked: CatalogRequest): Promise<Answer[]> {
  const seen: Answer[] = [];
  const subscription = client.query(asked.query, asked.variables).subscribe((result) => seen.push(answerOf(result)));
  await settle();
  subscription.unsubscribe();
  return seen;
}

export const promiseOf = (answer: Answer) => ({ toPromise: () => Promise.resolve(answer) });

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export const emptyCatalog: Answer = { data: { mangas: { edges: [] } } };

const searchRow = (slug: string, fields: Record<string, unknown> = {}) => ({
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
