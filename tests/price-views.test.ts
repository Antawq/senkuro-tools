import { describe, expect, it } from 'vitest';

import { Client, gql, makeResult, type Operation } from '@urql/core';

import type { Variables } from '../utils/inventory/list-families';
import type { Row } from '../utils/inventory/price-crawl';
import { createPrivateCursor } from '../utils/inventory/price-private';
import type { PageAnswer, ViewList } from '../utils/inventory/price-view';
import { createPriceViews, type ViewsHost } from '../utils/inventory/price-views';
import type { ListScope } from '../utils/shared/list-scope';
import type { PriceRows, PriceState } from '../utils/shared/price-signal';

const LIST = gql`
  query fetchUserCards($userId: ID!, $after: String) {
    userCards(first: 2, userId: $userId, after: $after) {
      edges {
        node {
          modifier
        }
      }
    }
  }
`;

const operations = new Client({ url: 'https://api.senkuro.me/graphql', exchanges: [] });

const gridVariables = (extra: Variables = {}): Variables => ({
  after: null,
  userId: 'USER:1',
  orderDirection: 'DESC',
  orderField: 'CREATED_AT',
  rank: { include: [] },
  color: { include: [] },
  modifier: { include: [0] },
  ...extra,
});

const pickerVariables = (extra: Variables = {}): Variables => ({
  userId: 'USER:1',
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
  after: null,
  rank: { include: [], exclude: [] },
  color: { include: [] },
  modifier: { exclude: [] },
  ...extra,
});

const listOperation = (variables: Variables, key: number): Operation => operations.createRequestOperation('query', { key, query: LIST, variables });

const listOf = (slugs: string[]): ViewList => ({
  rows: slugs.map((slug): Row => ({ node: { modifier: 0, locked: false, card: { id: `id-${slug}`, slug } } })),
  connectionType: 'UserCardConnection',
  pageInfoType: 'PageInfo',
  pageSize: 2,
});

interface Crawl {
  operation: Operation;
  signal: AbortSignal;
  finish: (list: ViewList | null) => void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const rig = () => {
  const states: { scope: ListScope; state: PriceState }[] = [];
  const rows: { scope: ListScope; rows: PriceRows }[] = [];
  const redrives: Operation[] = [];
  const crawls: Crawl[] = [];
  const host: ViewsHost = {
    isReady: () => true,
    crawl: (operation, _report, signal) => new Promise((finish) => void crawls.push({ operation, signal, finish })),
    redrive: (operation) => void redrives.push(operation),
    publishState: (scope, state) => void states.push({ scope, state }),
    publishRows: (scope, sent) => void rows.push({ scope, rows: sent }),
    debug: () => undefined,
  };
  const views = createPriceViews(host);
  const order = (scope: ListScope, at: number) => {
    const viewId = rows[at]?.rows.viewId ?? -1;
    views.receiveOrder(scope, { viewId, revision: 1, descending: [0, 1, 2], ascending: [2, 1, 0] });
  };
  return { views, states, rows, redrives, crawls, order };
};

const bothServed = async () => {
  const harness = rig();
  harness.views.watch(listOperation(gridVariables(), 1));
  harness.views.watch(listOperation(pickerVariables(), 2));
  harness.views.start('grid');
  harness.views.start('picker');
  harness.crawls[0]?.finish(listOf(['g1', 'g2', 'g3']));
  harness.crawls[1]?.finish(listOf(['p1', 'p2', 'p3']));
  await settle();
  harness.order('grid', 0);
  harness.order('picker', 1);
  return harness;
};

const slugsOf = (answer: PageAnswer | null): string[] => (answer?.userCards.edges ?? []).map((row) => String(row.node.card?.slug));

describe('the views of the grid and of the pickers', () => {
  it('crawl each its own list, so the profile grid and a window over it can both be sorted', async () => {
    const { crawls, rows } = await bothServed();
    expect(crawls.map((crawl) => crawl.operation.key)).toEqual([1, 2]);
    expect(rows.map((sent) => sent.scope)).toEqual(['grid', 'picker']);
  });

  it('answer each list from its own rows, through one answer', async () => {
    const { views } = await bothServed();
    expect(slugsOf(views.answer(listOperation(gridVariables(), 1)))).toEqual(['g1', 'g2']);
    expect(slugsOf(views.answer(listOperation(pickerVariables(), 2)))).toEqual(['p1', 'p2']);
    expect(slugsOf(views.answer(listOperation(pickerVariables({ after: createPrivateCursor(2, 2) }), 2)))).toEqual(['p1', 'p2', 'p3']);
  });

  it('never share a version or a view id, so a cursor of one list never moves the other', async () => {
    const { views, rows } = await bothServed();
    expect(new Set(rows.map((sent) => sent.rows.viewId)).size).toBe(2);
    expect(views.answer(listOperation(gridVariables(), 1))?.userCards.pageInfo.endCursor).toBe(createPrivateCursor(1, 2));
    expect(views.answer(listOperation(pickerVariables(), 2))?.userCards.pageInfo.endCursor).toBe(createPrivateCursor(2, 2));
    expect(slugsOf(views.answer(listOperation(gridVariables({ after: createPrivateCursor(2, 2) }), 1)))).toEqual(['g1', 'g2']);
  });

  it('start, stop and restart each list on its own', async () => {
    const { views, redrives, crawls } = await bothServed();
    views.stop('picker');
    expect(redrives.at(-1)?.key).toBe(2);
    expect(views.answer(listOperation(gridVariables(), 1))).not.toBeNull();
    expect(views.answer(listOperation(pickerVariables(), 2))).toBeNull();
    views.restart('grid');
    expect(crawls).toHaveLength(3);
    expect(crawls[2]?.operation.key).toBe(1);
    views.restart('picker');
    expect(crawls).toHaveLength(3);
  });

  it('say which list every state is about', async () => {
    const { states } = await bothServed();
    expect(states.filter((sent) => sent.state.name === 'ready').map((sent) => sent.scope)).toEqual(['grid', 'picker']);
  });

  it('hand a change of the inventory to every list', async () => {
    const { views, crawls } = await bothServed();
    const forge = operations.createRequestOperation('mutation', {
      key: 9,
      query: gql('mutation forgeCards($input: ID) { forgeCards(input: $input) { userId } }'),
      variables: {},
    });
    views.handleMutation(makeResult(forge, { data: { forgeCards: { userId: 'USER:1' } } }));
    expect(crawls.slice(2).map((crawl) => crawl.operation.key)).toEqual([1, 2]);
  });

  it('leave a request that is no list of cards of theirs alone', async () => {
    const { views } = await bothServed();
    const plain = listOperation({ userId: 'USER:1', after: createPrivateCursor(1, 2) }, 5);
    expect(views.answer(plain)).toBeNull();
    expect(views.forwarded(plain)).toBe(plain);
    const bare = listOperation({}, 6);
    expect(views.forwarded(bare)).toBe(bare);
  });
});
