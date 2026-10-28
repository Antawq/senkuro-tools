import { describe, expect, it } from 'vitest';

import type { MutationResult } from '../utils/inventory/client-hooks';
import type { Variables } from '../utils/inventory/list-families';
import type { Row } from '../utils/inventory/price-crawl';
import { createPrivateCursor, privateFieldOf } from '../utils/inventory/price-private';
import type { ListPage, ViewList } from '../utils/inventory/price-view';
import { createPriceViews, type ViewsHost } from '../utils/inventory/price-views';
import type { ListScope } from '../utils/shared/list-scope';
import type { PriceRows, PriceState } from '../utils/shared/price-signal';
import type { QueryRequest } from '../utils/shared/urql-client';

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

const request = (variables: Variables | undefined, key: number, name = 'fetchUserCards'): QueryRequest => ({
  key,
  ...(variables ? { variables } : {}),
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: name } }] },
});

const listOf = (slugs: string[]): ViewList => ({
  rows: slugs.map((slug): Row => ({ node: { modifier: 0, locked: false, card: { id: `id-${slug}`, slug } } })),
  connectionType: 'UserCardConnection',
  pageInfoType: 'PageInfo',
  pageSize: 2,
});

interface Crawl {
  page: ListPage;
  signal: AbortSignal;
  finish: (list: ViewList | null) => void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const rig = () => {
  const states: { scope: ListScope; state: PriceState }[] = [];
  const rows: { scope: ListScope; rows: PriceRows }[] = [];
  const redrives: { page: ListPage; variables: Variables }[] = [];
  const crawls: Crawl[] = [];
  const host: ViewsHost = {
    isReady: () => true,
    crawl: (page, _report, signal) => new Promise((finish) => void crawls.push({ page, signal, finish })),
    redrive: (page, variables) => void redrives.push({ page, variables }),
    refreshPage: () => undefined,
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
  harness.views.watch(request(gridVariables(), 1), {});
  harness.views.watch(request(pickerVariables(), 2), {});
  harness.views.start('grid');
  harness.views.start('picker');
  harness.crawls[0]?.finish(listOf(['g1', 'g2', 'g3']));
  harness.crawls[1]?.finish(listOf(['p1', 'p2', 'p3']));
  await settle();
  harness.order('grid', 0);
  harness.order('picker', 1);
  return harness;
};

const slugsOf = (answer: ReturnType<ReturnType<typeof createPriceViews>['answer']>): string[] =>
  answer.data.userCards.edges.map((row) => String(row.node.card?.slug));

describe('the views of the grid and of the pickers', () => {
  it('crawl each its own list, so the profile grid and a window over it can both be sorted', async () => {
    const { crawls, rows } = await bothServed();
    expect(crawls.map((crawl) => crawl.page.request.key)).toEqual([1, 2]);
    expect(rows.map((sent) => sent.scope)).toEqual(['grid', 'picker']);
  });

  it('give each list its own private list and answer each from its own rows, through one answer', async () => {
    const { views } = await bothServed();
    const grid = views.rewrite(request(gridVariables(), 1)).variables ?? {};
    const picker = views.rewrite(request(pickerVariables(), 2)).variables ?? {};
    expect(grid.orderField).toBe(privateFieldOf(1));
    expect(picker.orderField).toBe(privateFieldOf(2));
    expect(slugsOf(views.answer(grid))).toEqual(['g1', 'g2']);
    expect(slugsOf(views.answer(picker))).toEqual(['p1', 'p2']);
    expect(slugsOf(views.answer({ ...picker, after: createPrivateCursor(2, 2) }))).toEqual(['p3']);
  });

  it('never share a private version or a view id, so a list of one never links to the cached pages of the other', async () => {
    const { rows, redrives } = await bothServed();
    expect(new Set(rows.map((sent) => sent.rows.viewId)).size).toBe(2);
    expect(redrives.map((redrive) => redrive.variables.orderField)).toEqual([privateFieldOf(1), privateFieldOf(2)]);
  });

  it('start, stop and restart each list on its own', async () => {
    const { views, redrives, crawls } = await bothServed();
    views.stop('picker');
    expect(redrives.at(-1)?.page.request.key).toBe(2);
    expect(views.rewrite(request(gridVariables(), 1)).variables?.orderField).toBe(privateFieldOf(1));
    const picker = request(pickerVariables(), 2);
    expect(views.rewrite(picker)).toBe(picker);
    views.restart('grid');
    expect(crawls).toHaveLength(3);
    expect(crawls[2]?.page.request.key).toBe(1);
    views.restart('picker');
    expect(crawls).toHaveLength(3);
  });

  it('say which list every state is about', async () => {
    const { states } = await bothServed();
    expect(states.filter((sent) => sent.state.name === 'ready').map((sent) => sent.scope)).toEqual(['grid', 'picker']);
  });

  it('hand a change of the inventory to every list', async () => {
    const { views, crawls } = await bothServed();
    const forged: MutationResult = { operation: request({ input: {} }, 9, 'forgeCards'), data: { forgeCards: { userId: 'USER:1' } } };
    views.handleMutation(forged);
    expect(crawls.slice(2).map((crawl) => crawl.page.request.key)).toEqual([1, 2]);
  });

  it('leave a request that is no list of cards alone, and answer an empty page for a private name nobody serves', async () => {
    const { views } = await bothServed();
    const plain = request({ userId: 'USER:1', after: createPrivateCursor(1, 2) }, 5);
    expect(views.rewrite(plain)).toBe(plain);
    const bare = request(undefined, 6);
    expect(views.rewrite(bare)).toBe(bare);
    expect(views.answer({ orderField: privateFieldOf(1) }).data.userCards.edges).toEqual([]);
    expect(views.answer(pickerVariables({ orderField: privateFieldOf(7) })).data.userCards.edges).toEqual([]);
  });
});
