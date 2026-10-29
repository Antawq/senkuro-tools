import { describe, expect, it } from 'vitest';

import { Client, gql, makeOperation, type Operation, type OperationResult } from '@urql/core';

import type { Variables } from '../utils/inventory/list-families';
import type { Row } from '../utils/inventory/price-crawl';
import { createCursorLedger, cursorExchange } from '../utils/inventory/list-cursors';
import { priceExchange } from '../utils/inventory/price-exchange';
import { createPrivateCursor, hasPrivateCursor } from '../utils/inventory/price-private';
import type { ViewList } from '../utils/inventory/price-view';
import { createPriceViews } from '../utils/inventory/price-views';
import { delegateExchange } from '../utils/shared/delegate-exchange';
import { SITE_URL, createSiteClient, nameOf, tick } from './helpers/site-client';

const LIST = gql`
  query fetchUserCards($userId: ID!, $after: String, $orderDirection: OrderDirection, $modifier: Filter) {
    userCards(first: 2, userId: $userId, after: $after, direction: $orderDirection, modifier: $modifier) {
      edges {
        node {
          modifier
          locked
          card {
            id
            slug
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const LOCK = gql`
  mutation bulkUpdateUserCardLock($input: ID) {
    bulkUpdateUserCardLock(input: $input) {
      success
    }
  }
`;

const grid = (extra: Variables = {}): Variables => ({ userId: 'USER:1', orderDirection: 'DESC', modifier: { include: [0] }, after: null, ...extra });

const rowOf = (slug: string): Row => ({ node: { modifier: 0, locked: false, card: { id: `id-${slug}`, slug } } });

const crawledList = (): ViewList => ({
  rows: ['a', 'b', 'c', 'd', 'e'].map(rowOf),
  connectionType: 'UserCardConnection',
  pageInfoType: 'PageInfo',
  pageSize: 2,
});

const sitePage = {
  userCards: {
    edges: [{ node: { modifier: 0, locked: false, card: { id: 'id-real', slug: 'real' } } }],
    pageInfo: { hasNextPage: true, endCursor: 'real-20' },
  },
};

const slugsOf = (result: OperationResult | undefined): string[] =>
  ((result?.data as { userCards?: { edges?: Row[] } } | undefined)?.userCards?.edges ?? []).map((row) => String(row.node.card?.slug));

const rig = ({ delayMs = 0, foreignCursor }: { delayMs?: number; foreignCursor?: string } = {}) => {
  const site = createSiteClient((operation) => {
    if (operation.kind === 'mutation') return { data: { bulkUpdateUserCardLock: { success: true } } };
    return { data: sitePage, delayMs };
  });
  const silent = new WeakSet<object>();
  const holder: { client: Client | null } = { client: null };
  const crawls: number[] = [];
  const views = createPriceViews({
    isReady: () => true,
    crawl: () => {
      crawls.push(crawls.length);
      return Promise.resolve(crawledList());
    },
    redrive: (operation) =>
      holder.client?.reexecuteOperation(makeOperation(operation.kind, operation, { ...operation.context, requestPolicy: 'network-only' })),
    publishState: () => undefined,
    publishRows: (scope, rows) => views.receiveOrder(scope, { viewId: rows.viewId, revision: 1, descending: [2, 0, 4, 1, 3], ascending: [3, 1, 4, 0, 2] }),
    debug: () => undefined,
  });
  const rekeyed: Operation[] = [];
  const ledger = createCursorLedger();
  if (foreignCursor) ledger.learn(grid({ modifier: { include: [1] } }), foreignCursor);
  const client = new Client({
    url: SITE_URL,
    exchanges: [
      cursorExchange(ledger),
      priceExchange(views, (context) => typeof context.fetch === 'function' && silent.has(context.fetch)),
      delegateExchange(site.client, (operation) => rekeyed.push(operation)),
    ],
  });
  holder.client = client;
  const browse = (variables: Variables) => {
    const results: OperationResult[] = [];
    const subscription = client.query(LIST, variables).subscribe((result) => results.push(result));
    return { results, subscription };
  };
  const siteLists = () => site.operations.filter((operation) => operation.kind === 'query' && nameOf(operation) === 'fetchUserCards');
  return { site, client, views, silent, rekeyed, browse, siteLists, crawls };
};

describe('priceExchange', () => {
  it('passes the list to the site while it is off, in the order of the site', async () => {
    const { browse, siteLists } = rig();
    const { results, subscription } = browse(grid());
    await tick();
    expect(slugsOf(results.at(-1))).toEqual(['real']);
    expect(siteLists()).toHaveLength(1);
    subscription.unsubscribe();
  });

  it('answers the list itself once its order is in, asks the site nothing for it, and lets the site drop the key', async () => {
    const { browse, views, site, siteLists } = rig();
    const { results, subscription } = browse(grid());
    await tick();
    views.start('grid');
    await tick();
    await tick();
    expect(slugsOf(results.at(-1))).toEqual(['c', 'a']);
    expect(siteLists()).toHaveLength(1);
    expect(site.openKeys()).toEqual([]);
    subscription.unsubscribe();
  });

  it('answers a later page with every row up to its end, as the cache would have merged the pages, from the one crawl', async () => {
    const { browse, views, crawls } = rig();
    browse(grid()).subscription.unsubscribe();
    views.start('grid');
    await tick();
    await tick();
    const second = browse(grid({ after: createPrivateCursor(1, 2) }));
    await tick();
    expect(slugsOf(second.results.at(-1))).toEqual(['c', 'a', 'e', 'b']);
    expect(crawls).toHaveLength(1);
    second.subscription.unsubscribe();
  });

  it('turns the order around in place for the other direction, keeping the cursor', async () => {
    const { browse, views } = rig();
    browse(grid()).subscription.unsubscribe();
    views.start('grid');
    await tick();
    await tick();
    const ascending = browse(grid({ orderDirection: 'ASC', after: createPrivateCursor(1, 2) }));
    await tick();
    expect(slugsOf(ascending.results.at(-1))).toEqual(['d', 'b', 'e', 'a']);
    ascending.subscription.unsubscribe();
  });

  it('gives the site list back when it is switched off, from the first page, and never sends a private cursor to the site', async () => {
    const { browse, views, siteLists, rekeyed } = rig();
    browse(grid()).subscription.unsubscribe();
    views.start('grid');
    await tick();
    await tick();
    const later = browse(grid({ after: createPrivateCursor(1, 2) }));
    await tick();
    views.stop('grid');
    await tick();
    expect(slugsOf(later.results.at(-1))).toEqual(['real']);
    expect(siteLists().map((operation) => (operation.variables as Variables).after)).toEqual([null, null]);
    expect(siteLists().some((operation) => hasPrivateCursor((operation.variables as Variables).after))).toBe(false);
    expect(rekeyed).toHaveLength(1);
    expect(later.results.at(-1)?.operation.key).toBe(later.results[0]?.operation.key);
    later.subscription.unsubscribe();
  });

  it('answers a list the site still had on its way when the order came, instead of the late answer of the site', async () => {
    const { browse, views } = rig({ delayMs: 30 });
    const { results, subscription } = browse(grid());
    views.start('grid');
    await tick();
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(slugsOf(results.at(-1))).toEqual(['c', 'a']);
    subscription.unsubscribe();
  });

  it('lets a silent replay of a list it serves reach the site, gives its caller and the grid its own answer, and leaves the site no key once the grid is gone', async () => {
    const { client, browse, views, silent, site, siteLists } = rig();
    const { results, subscription } = browse(grid());
    await tick();
    views.start('grid');
    await tick();
    await tick();
    const capture = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init);
    silent.add(capture);
    const replay = await client.query(LIST, grid(), { requestPolicy: 'network-only', fetch: capture }).toPromise();
    expect(siteLists()).toHaveLength(2);
    expect(slugsOf(replay)).toEqual(['c', 'a']);
    expect(slugsOf(results.at(-1))).toEqual(['c', 'a']);
    subscription.unsubscribe();
    await tick();
    expect(site.openKeys()).toEqual([]);
  });

  it('shows a lock in the list it serves at once, without asking the site', async () => {
    const { client, browse, views, siteLists } = rig();
    const { results, subscription } = browse(grid());
    await tick();
    views.start('grid');
    await tick();
    await tick();
    await client.mutation(LOCK, { input: { userId: 'USER:1', cards: [{ cardId: 'id-a', modifier: 0 }], locked: true } }).toPromise();
    await tick();
    const rows = (results.at(-1)?.data as { userCards: { edges: Row[] } }).userCards.edges;
    expect(rows.map((row) => row.node.locked)).toEqual([false, true]);
    expect(siteLists()).toHaveLength(1);
    subscription.unsubscribe();
  });

  it('gives the real list back with the cursor the guard repaired, not the foreign one it dropped', async () => {
    const { browse, views, siteLists } = rig({ foreignCursor: 'c1' });
    const { results, subscription } = browse(grid({ after: 'c1' }));
    await tick();
    views.start('grid');
    await tick();
    await tick();
    expect(slugsOf(results.at(-1))).toEqual(['c', 'a']);
    views.stop('grid');
    await tick();
    expect(siteLists().map((operation) => (operation.variables as Variables).after)).toEqual([null, null]);
    expect(slugsOf(results.at(-1))).toEqual(['real']);
    subscription.unsubscribe();
  });
});
