import { describe, expect, it } from 'vitest';

import { Client, gql, makeOperation, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { map, pipe } from 'wonka';

import { callerContextOf, defaultContextOf, delegateExchange } from '../utils/shared/delegate-exchange';
import { SITE_URL, createSiteClient, nameOf, siteFetchOptions, tick, type SiteAnswer } from './helpers/site-client';

const VIEWER = gql`
  query fetchViewer {
    viewer {
      id
    }
  }
`;

const CARDS = gql`
  query fetchUserCards($userId: ID!, $after: String) {
    userCards(first: 20, userId: $userId, after: $after) {
      edges {
        node {
          modifier
        }
      }
    }
  }
`;

const LOCK = gql`
  mutation bulkUpdateUserCardLock($input: ID!) {
    bulkUpdateUserCardLock(input: $input) {
      success
    }
  }
`;

const NEWS = gql`
  subscription conversationMessages {
    conversationMessages {
      id
    }
  }
`;

const answers: SiteAnswer = (operation) => {
  if (nameOf(operation) === 'fetchViewer') return { data: { viewer: { id: 'U1' } }, cacheOutcome: 'hit' };
  if (operation.kind === 'mutation') return { data: { bulkUpdateUserCardLock: { success: true } } };
  if (operation.kind === 'subscription') return { data: { conversationMessages: { id: 'M1' } } };
  return { data: { userCards: { edges: [] } }, cacheOutcome: 'miss' };
};

const rig = (above: Exchange[] = []) => {
  const site = createSiteClient(answers);
  const rekeyed: Operation[] = [];
  const client = new Client({ url: SITE_URL, suspense: true, exchanges: [...above, delegateExchange(site.client, (operation) => rekeyed.push(operation))] });
  return { site, client, rekeyed };
};

const siteQueries = (operations: Operation[]) => operations.filter((operation) => operation.kind === 'query');

describe('delegateExchange', () => {
  it('runs a query on the site client with the site options for the request, never its own client defaults', async () => {
    const { site, client } = rig();
    const results: OperationResult[] = [];
    const subscription = client.query(VIEWER, {}).subscribe((result) => results.push(result));
    await tick();
    const [siteOperation] = siteQueries(site.operations);
    expect(results.map((result): unknown => result.data)).toEqual([{ viewer: { id: 'U1' } }]);
    expect(siteOperation?.context.fetchOptions).toBe(siteFetchOptions);
    expect(siteOperation?.context.preferGetMethod).toBe(false);
    expect(results[0]?.operation.context.fetchOptions).toBeUndefined();
    subscription.unsubscribe();
  });

  it('keeps the request key of an operation nobody changed, and answers with the operation of the caller', async () => {
    const { site, client, rekeyed } = rig();
    const results: OperationResult[] = [];
    const subscription = client.query(CARDS, { userId: 'U1', after: null }).subscribe((result) => results.push(result));
    await tick();
    expect(siteQueries(site.operations)[0]?.key).toBe(results[0]?.operation.key);
    expect(results[0]?.operation.context.url).toBe(SITE_URL);
    expect(rekeyed).toEqual([]);
    subscription.unsubscribe();
  });

  it('gives the site a fresh key for an operation an exchange above rewrote, and the answer still reaches the caller', async () => {
    const dropCursor: Exchange =
      ({ forward }) =>
      (operations$) =>
        forward(
          pipe(
            operations$,
            map((operation) =>
              operation.kind === 'query'
                ? makeOperation(operation.kind, { ...operation, variables: { ...operation.variables, after: null } }, operation.context)
                : operation
            )
          )
        );
    const { site, client, rekeyed } = rig([dropCursor]);
    const results: OperationResult[] = [];
    const subscription = client.query(CARDS, { userId: 'U1', after: 'c40' }).subscribe((result) => results.push(result));
    await tick();
    const [siteOperation] = siteQueries(site.operations);
    expect(siteOperation?.variables).toEqual({ userId: 'U1', after: null });
    expect(siteOperation?.key).not.toBe(results[0]?.operation.key);
    expect(results).toHaveLength(1);
    expect(rekeyed.map(nameOf)).toEqual(['fetchUserCards']);
    subscription.unsubscribe();
  });

  it('copies the cache outcome of the site result onto the answer', async () => {
    const { client } = rig();
    const result = await client.query(VIEWER, {}).toPromise();
    expect(result.operation.context.meta?.cacheOutcome).toBe('hit');
  });

  it('sends a network-only refetch to the site once, without a teardown in between', async () => {
    const { site, client } = rig();
    const results: OperationResult[] = [];
    const subscription = client.query(VIEWER, {}).subscribe((result) => results.push(result));
    await tick();
    const before = site.operations.length;
    const [first] = results;
    client.reexecuteOperation(makeOperation('query', first!.operation, { ...first!.operation.context, requestPolicy: 'network-only' }));
    await tick();
    const after = site.operations.slice(before);
    expect(after.map((operation) => `${operation.kind}:${operation.context.requestPolicy}`)).toEqual(['query:network-only']);
    expect(results.length).toBeGreaterThanOrEqual(2);
    subscription.unsubscribe();
  });

  it('releases the site key on teardown, so the site holds no key once every caller left', async () => {
    const { site, client } = rig();
    const viewer = client.query(VIEWER, {}).subscribe(() => undefined);
    const cards = client.query(CARDS, { userId: 'U1', after: null }).subscribe(() => undefined);
    const nextPage = client.query(CARDS, { userId: 'U1', after: 'c20' }).subscribe(() => undefined);
    await tick();
    expect(site.openKeys()).toHaveLength(3);
    viewer.unsubscribe();
    cards.unsubscribe();
    nextPage.unsubscribe();
    await tick();
    expect(site.openKeys()).toEqual([]);
  });

  it('runs a mutation once on the site with the instance of the site client, not its own', async () => {
    const { site, client } = rig();
    await site.client.mutation(LOCK, { input: 'c0' }).toPromise();
    const result = await client.mutation(LOCK, { input: 'c1' }).toPromise();
    const siteMutations = site.operations.filter((operation) => operation.kind === 'mutation');
    expect(result.data).toEqual({ bulkUpdateUserCardLock: { success: true } });
    expect(siteMutations).toHaveLength(2);
    expect(siteMutations.map((operation) => operation.context._instance)).toEqual([1, 2]);
    expect(result.operation.context._instance).toBe(1);
  });

  it('runs a subscription on the site and tears it down there when the caller leaves', async () => {
    const { site, client } = rig();
    const results: OperationResult[] = [];
    const subscription = client.subscription(NEWS, {}).subscribe((result) => results.push(result));
    await tick();
    expect(results.map((result): unknown => result.data)).toEqual([{ conversationMessages: { id: 'M1' } }]);
    expect(site.operations.filter((operation) => operation.kind === 'subscription')).toHaveLength(1);
    subscription.unsubscribe();
    await tick();
    expect(site.openKeys()).toEqual([]);
  });
});

describe('callerContextOf', () => {
  it('keeps what the caller set and drops the defaults of its own client, the instance and the result metadata', () => {
    const client = new Client({ url: SITE_URL, suspense: true, exchanges: [] });
    const defaults = defaultContextOf(client);
    const capture = () => Promise.resolve(new Response());
    const asked = client.createRequestOperation(
      'mutation',
      { key: 1, query: LOCK, variables: {} },
      { requestPolicy: 'network-only', fetch: capture, meta: { cacheOutcome: 'hit' } }
    );
    expect(callerContextOf(asked.context, defaults)).toEqual({ requestPolicy: 'network-only', fetch: capture });
    expect(callerContextOf(defaults, defaults)).toEqual({ requestPolicy: 'cache-first' });
  });
});
