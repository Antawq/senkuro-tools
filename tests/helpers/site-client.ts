import { Client, getOperationName, makeOperation, makeResult, type CacheOutcome, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { delay, filter, fromValue, mergeMap, pipe, subscribe } from 'wonka';

export const SITE_URL = 'https://api.senkuro.me/graphql';

export const siteFetchOptions = () => ({ headers: { Authorization: 'Bearer site' } });

export type SiteAnswer = (operation: Operation) => { data?: unknown; error?: string; cacheOutcome?: CacheOutcome; delayMs?: number } | null;

export interface SiteClient {
  client: Client;
  operations: Operation[];
  openKeys: () => number[];
}

const resultFor = (operation: Operation, answer: ReturnType<SiteAnswer>): OperationResult => {
  const answered = answer?.cacheOutcome
    ? makeOperation(operation.kind, operation, { ...operation.context, meta: { cacheOutcome: answer.cacheOutcome } })
    : operation;
  if (answer?.error) return makeResult(answered, { errors: [{ message: answer.error }] });
  return makeResult(answered, { data: answer?.data ?? null });
};

const answeringExchange =
  (answer: SiteAnswer): Exchange =>
  () =>
  (operations$) =>
    pipe(
      operations$,
      filter((operation) => operation.kind !== 'teardown'),
      mergeMap((operation) => {
        const answered = answer(operation);
        const result$ = fromValue(resultFor(operation, answered));
        return answered?.delayMs ? pipe(result$, delay(answered.delayMs)) : result$;
      })
    );

export function createSiteClient(answer: SiteAnswer): SiteClient {
  const client = new Client({ url: SITE_URL, fetchOptions: siteFetchOptions, preferGetMethod: false, suspense: true, exchanges: [answeringExchange(answer)] });
  const operations: Operation[] = [];
  pipe(
    client.operations$,
    subscribe((operation: Operation) => operations.push(operation))
  );
  const openKeys = () => {
    const open = new Set<number>();
    for (const operation of operations) {
      if (operation.kind === 'teardown') open.delete(operation.key);
      else if (operation.kind !== 'mutation') open.add(operation.key);
    }
    return [...open];
  };
  return { client, operations, openKeys };
}

export const nameOf = (operation: Operation): string | undefined => getOperationName(operation.query);

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
