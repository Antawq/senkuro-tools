import { describe, expect, it } from 'vitest';

import type { MutationResult } from '../utils/inventory/client-hooks';
import type { Variables } from '../utils/inventory/list-families';
import type { Row } from '../utils/inventory/price-crawl';
import { cursorOf, privateFieldOf } from '../utils/inventory/price-private';
import { createPriceView, type ListPage, type ViewHost, type ViewList } from '../utils/inventory/price-view';
import type { PriceRows, PriceState } from '../utils/shared/price-signal';
import type { QueryRequest } from '../utils/shared/urql-client';

const gridVariables = (extra: Variables = {}): Variables => ({
  userId: 'USER:1',
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
  rank: { include: [] },
  modifier: { include: [0] },
  after: null,
  ...extra,
});

const pickerOf = (variables: Variables): Variables =>
  Object.fromEntries(Object.entries(variables).filter(([name]) => name !== 'orderField' && name !== 'orderDirection'));

const request = (variables: Variables | undefined, name = 'fetchUserCards', key = 7): QueryRequest => ({
  key,
  ...(variables ? { variables } : {}),
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: name } }] },
});

const rowOf = (slug: string, modifier = 0, locked = false): Row => ({ node: { modifier, locked, card: { id: `id-${slug}`, slug } } });

const listOf = (slugs: string[], pageSize = 2): ViewList => ({
  rows: slugs.map((slug) => rowOf(slug)),
  connectionType: 'ConnectionOfCards',
  pageInfoType: 'PageInfoOfCards',
  pageSize,
});

const SLUGS = ['a', 'b', 'c', 'd', 'e'];
const DESCENDING = [2, 0, 4, 1, 3];
const ASCENDING = [3, 1, 4, 0, 2];

interface Crawl {
  page: ListPage;
  report: (loaded: number, total: number | null) => void;
  signal: AbortSignal;
  finish: (list: ViewList | null) => void;
  fail: () => void;
}

const rig = ({ isReady = true }: { isReady?: boolean } = {}) => {
  const states: PriceState[] = [];
  const rows: PriceRows[] = [];
  const redrives: { page: ListPage; variables: Variables }[] = [];
  const refreshes: { page: ListPage; variables: Variables }[] = [];
  const crawls: Crawl[] = [];
  const host: ViewHost = {
    isReady: () => isReady,
    crawl: (page, report, signal) =>
      new Promise((finish, reject) => {
        crawls.push({ page, report, signal, finish, fail: () => reject(new Error('crawl failed')) });
      }),
    redrive: (page, variables) => void redrives.push({ page, variables }),
    refreshPage: (page, variables) => void refreshes.push({ page, variables }),
    publishState: (state) => void states.push(state),
    publishRows: (sent) => void rows.push(sent),
    debug: () => undefined,
  };
  return { view: createPriceView(host), states, rows, redrives, refreshes, crawls };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const crawled = async (slugs = SLUGS) => {
  const harness = rig();
  harness.view.watch(request(gridVariables()), { suspense: true });
  harness.view.start();
  harness.crawls[0]?.finish(listOf(slugs));
  await settle();
  return harness;
};

const served = async (variables: Variables = gridVariables()) => {
  const harness = rig();
  harness.view.watch(request(variables), { suspense: true });
  harness.view.start();
  harness.crawls[0]?.finish(listOf(SLUGS));
  await settle();
  harness.view.receiveOrder({ viewId: harness.rows[0]?.viewId ?? -1, revision: 1, descending: DESCENDING, ascending: ASCENDING });
  return harness;
};

const slugsOf = (answer: ReturnType<ReturnType<typeof createPriceView>['answer']>): string[] =>
  answer.data.userCards.edges.map((row) => String(row.node.card?.slug));

const forged = (): MutationResult => ({ operation: request({ input: {} }, 'forgeCards'), data: { forgeCards: { userId: 'USER:1' } } });

const accepted = (name = 'acceptCardTrade', success = true): MutationResult => ({ operation: request({}, name), data: { [name]: { success } } });

const locked = (cards: { cardId: string; modifier: number }[], isLocked = true, userId = 'USER:1'): MutationResult => ({
  operation: request({ input: { userId, cards, locked: isLocked } }, 'bulkUpdateUserCardLock'),
  data: { bulkUpdateUserCardLock: { success: true } },
});

describe('starting', () => {
  it('says it is unavailable when no list was asked for yet, and when the page cannot run it', () => {
    const noList = rig();
    noList.view.start();
    expect(noList.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
    expect(noList.crawls).toHaveLength(0);
    const notReady = rig({ isReady: false });
    notReady.view.watch(request(gridVariables()), {});
    notReady.view.start();
    expect(notReady.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
    expect(notReady.crawls).toHaveLength(0);
  });

  it('crawls the grid and never a picker the page asked for after it, since only the grid is served', () => {
    const picker = { userId: 'USER:1', modifier: { exclude: [1] }, rank: { include: [], exclude: ['F'] } };
    const withGrid = rig();
    withGrid.view.watch(request(gridVariables(), 'fetchUserCards', 1), {});
    withGrid.view.watch(request(picker, 'fetchUserCards', 2), {});
    withGrid.view.start();
    expect(withGrid.crawls).toHaveLength(1);
    expect(withGrid.crawls[0]?.page.request.key).toBe(1);
    const onlyPicker = rig();
    onlyPicker.view.watch(request(picker, 'fetchUserCards', 3), {});
    onlyPicker.view.start();
    expect(onlyPicker.crawls).toHaveLength(0);
    expect(onlyPicker.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
  });

  it('crawls the list the site asked for last and says it is loading, and how far it is', () => {
    const { view, states, crawls } = rig();
    view.watch(request(gridVariables({ rank: { include: ['S'] } }), 'fetchUserCards', 1), {});
    view.watch(request(gridVariables(), 'fetchUserCards', 2), { suspense: true });
    view.start();
    expect(crawls).toHaveLength(1);
    expect(crawls[0]?.page.request.key).toBe(2);
    expect(crawls[0]?.page.options).toEqual({ suspense: true });
    expect(states).toEqual([{ name: 'loading', loaded: 0, total: null }]);
    crawls[0]?.report(40, 100);
    expect(states.at(-1)).toEqual({ name: 'loading', loaded: 40, total: 100 });
  });

  it('hands the slugs of the list over, in the order it was crawled, once it has it', async () => {
    const { rows } = await crawled(['a', 'b', 'c']);
    expect(rows).toEqual([{ viewId: 1, slugs: ['a', 'b', 'c'] }]);
  });

  it('gives a null for a card that has no slug', async () => {
    const harness = rig();
    harness.view.watch(request(gridVariables()), {});
    harness.view.start();
    harness.crawls[0]?.finish({ ...listOf(['a']), rows: [rowOf('a'), { node: { modifier: 0, card: { id: 'x' } } }] });
    await settle();
    expect(harness.rows[0]?.slugs).toEqual(['a', null]);
  });

  it('says it is unavailable when the crawl cannot start, and failed when it fails or finds nothing', async () => {
    const cannot = rig();
    cannot.view.watch(request(gridVariables()), {});
    cannot.view.start();
    cannot.crawls[0]?.finish(null);
    await settle();
    expect(cannot.states.at(-1)).toEqual({ name: 'unavailable', loaded: 0, total: null });
    const broken = rig();
    broken.view.watch(request(gridVariables()), {});
    broken.view.start();
    broken.crawls[0]?.fail();
    await settle();
    expect(broken.states.at(-1)).toEqual({ name: 'failed', loaded: 0, total: null });
    const empty = rig();
    empty.view.watch(request(gridVariables()), {});
    empty.view.start();
    empty.crawls[0]?.finish(listOf([]));
    await settle();
    expect(empty.states.at(-1)).toEqual({ name: 'failed', loaded: 0, total: null });
    expect(empty.rows).toHaveLength(0);
  });

  it('forgets a crawl that was left for another one', async () => {
    const { view, crawls, rows, states } = rig();
    view.watch(request(gridVariables()), {});
    view.start();
    view.watch(request(gridVariables({ rank: { include: ['S'] } })), {});
    expect(crawls[0]?.signal.aborted).toBe(true);
    crawls[0]?.finish(listOf(['old']));
    await settle();
    expect(rows).toHaveLength(0);
    crawls[1]?.finish(listOf(['new']));
    await settle();
    expect(rows).toEqual([{ viewId: 2, slugs: ['new'] }]);
    expect(states.filter((state) => state.name === 'failed')).toHaveLength(0);
  });
});

describe('serving the list', () => {
  it('does not serve until the order has come: the grid keeps the list of the site', async () => {
    const { view } = await crawled();
    const asked = request(gridVariables());
    expect(view.rewrite(asked)).toBe(asked);
  });

  it('serves from the moment the order has come: says so, and asks the grid again for its private list', async () => {
    const { view, states, redrives } = await served();
    expect(states.at(-1)).toEqual({ name: 'ready', loaded: 5, total: 5 });
    expect(redrives).toHaveLength(1);
    expect(redrives[0]?.variables).toEqual(gridVariables({ orderField: privateFieldOf(1), after: null }));
    expect(redrives[0]?.page.request.key).toBe(7);
    const rewritten = view.rewrite(request(gridVariables({ after: 'UgECAA_YJe18' })));
    expect(rewritten.key).toBe(7);
    expect(rewritten.variables).toEqual(gridVariables({ orderField: privateFieldOf(1), after: null }));
  });

  it('keeps the direction the site asks for and the cursor of the version it serves', async () => {
    const { view } = await served();
    expect(view.rewrite(request(gridVariables({ orderDirection: 'ASC', after: cursorOf(1, 2) }))).variables).toEqual(
      gridVariables({ orderField: privateFieldOf(1), orderDirection: 'ASC', after: cursorOf(1, 2) })
    );
  });

  it('answers a page of the sorted list with the type names the server used, and a cursor for the next', async () => {
    const { view } = await served();
    const first = view.answer(gridVariables({ orderField: privateFieldOf(1) }));
    expect(slugsOf(first)).toEqual(['c', 'a']);
    expect(first.data.userCards.__typename).toBe('ConnectionOfCards');
    expect(first.data.userCards.pageInfo).toEqual({ __typename: 'PageInfoOfCards', hasNextPage: true, endCursor: cursorOf(1, 2) });
    const second = view.answer(gridVariables({ orderField: privateFieldOf(1), after: cursorOf(1, 2) }));
    expect(slugsOf(second)).toEqual(['e', 'b']);
    expect(second.data.userCards.pageInfo).toMatchObject({ hasNextPage: true, endCursor: cursorOf(1, 4) });
    const last = view.answer(gridVariables({ orderField: privateFieldOf(1), after: cursorOf(1, 4) }));
    expect(slugsOf(last)).toEqual(['d']);
    expect(last.data.userCards.pageInfo).toMatchObject({ hasNextPage: false, endCursor: null });
  });

  it('answers the rows as they were crawled, the same objects, so nothing the card needs is lost', async () => {
    const { view, crawls } = await served();
    const crawledRows = crawls.length;
    expect(crawledRows).toBe(1);
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges[0]).toEqual(rowOf('c'));
  });

  it('answers the other way round for the other direction of the site', async () => {
    const { view } = await served();
    expect(slugsOf(view.answer(gridVariables({ orderField: privateFieldOf(1), orderDirection: 'ASC' })))).toEqual(['d', 'b']);
  });

  it('starts over for a cursor of another version or of the server, instead of serving the middle of another list', async () => {
    const { view } = await served();
    for (const after of [cursorOf(0, 2), cursorOf(9, 2), 'UgECAA_YJe18', 'senkutools:price:broken']) {
      expect(slugsOf(view.answer(gridVariables({ orderField: privateFieldOf(1), after })))).toEqual(['c', 'a']);
    }
  });

  it('leaves alone the lists that are not the one it serves: another filter, another field, other names, another user', async () => {
    const { view } = await served();
    const picker = pickerOf(gridVariables());
    for (const variables of [
      gridVariables({ modifier: { include: [1] } }),
      gridVariables({ orderField: 'RANK' }),
      picker,
      gridVariables({ userId: 'USER:2' }),
      gridVariables({ animated: false }),
    ]) {
      const asked = request(variables);
      expect(view.rewrite(asked)).toBe(asked);
    }
  });

  it('leaves a request without variables alone', async () => {
    const { view } = await served();
    const asked = request(undefined);
    expect(view.rewrite(asked)).toBe(asked);
  });

  it('turns a private cursor into the start of the real list when it is not serving that list', async () => {
    const { view } = await crawled();
    const rewritten = view.rewrite(request(gridVariables({ after: cursorOf(1, 4) })));
    expect(rewritten.variables).toEqual(gridVariables({ after: null }));
    expect(rewritten.key).toBe(7);
  });
});

describe('an answer that cannot be served', () => {
  const emptyPage = { hasNextPage: false, endCursor: null };

  it('is an empty page, never an error and never a request to the server, whatever was asked', async () => {
    const privateVariables = gridVariables({ orderField: privateFieldOf(1) });
    const nothing = rig();
    expect(nothing.view.answer(privateVariables).data.userCards.edges).toEqual([]);
    expect(nothing.view.answer(privateVariables).data.userCards.pageInfo).toMatchObject(emptyPage);
    const crawling = await crawled();
    expect(crawling.view.answer(privateVariables).data.userCards.edges).toEqual([]);
    const { view } = await served();
    for (const variables of [
      gridVariables({ orderField: privateFieldOf(2) }),
      gridVariables({ orderField: 'CREATED_AT' }),
      gridVariables({ orderField: privateFieldOf(1), userId: 'USER:2' }),
      {},
    ]) {
      expect(view.answer(variables).data.userCards.edges).toEqual([]);
    }
  });

  it('is an empty page after the view stopped', async () => {
    const { view } = await served();
    view.stop();
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges).toEqual([]);
  });
});

describe('the order', () => {
  it('is dropped when it is for another view, comes too early, is not a whole order, or is not newer', async () => {
    const { view, rows, redrives, states } = await crawled();
    const viewId = rows[0]?.viewId ?? -1;
    const valid = { viewId, revision: 1, descending: DESCENDING, ascending: ASCENDING };
    view.receiveOrder({ ...valid, viewId: viewId + 1 });
    view.receiveOrder({ ...valid, descending: [0, 1, 2, 3] });
    view.receiveOrder({ ...valid, descending: [0, 0, 1, 2, 3] });
    view.receiveOrder({ ...valid, ascending: [0, 1, 2, 3, 7] });
    view.receiveOrder({ ...valid, revision: 0 });
    expect(redrives).toHaveLength(0);
    expect(states.filter((state) => state.name === 'ready')).toHaveLength(0);
    view.receiveOrder(valid);
    expect(redrives).toHaveLength(1);
    view.receiveOrder(valid);
    expect(redrives).toHaveLength(1);
  });

  it('is dropped while the list is still being crawled', () => {
    const { view, redrives } = rig();
    view.watch(request(gridVariables()), {});
    view.start();
    view.receiveOrder({ viewId: 1, revision: 1, descending: [], ascending: [] });
    expect(redrives).toHaveLength(0);
  });

  it('is replaced by a newer one for the same list, as another list for the cache, and the grid is asked again', async () => {
    const { view, redrives, rows } = await served();
    view.receiveOrder({ viewId: rows[0]?.viewId ?? -1, revision: 2, descending: ASCENDING, ascending: DESCENDING });
    expect(redrives).toHaveLength(2);
    expect(redrives[1]?.variables).toEqual(gridVariables({ orderField: privateFieldOf(2), after: null }));
    expect(slugsOf(view.answer(gridVariables({ orderField: privateFieldOf(2) })))).toEqual(['d', 'b']);
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges).toEqual([]);
  });

  it('is dropped when it comes for a view that was left for another', async () => {
    const { view, rows, redrives, crawls } = await crawled();
    view.watch(request(gridVariables({ modifier: { include: [1] } })), {});
    crawls[1]?.finish(listOf(['x']));
    await settle();
    view.receiveOrder({ viewId: rows[0]?.viewId ?? -1, revision: 1, descending: DESCENDING, ascending: ASCENDING });
    expect(redrives).toHaveLength(0);
  });
});

describe('stopping', () => {
  it('gives the grid its own list back when it was serving, starting from the first page of it', async () => {
    const { view, redrives } = await served();
    view.rewrite(request(gridVariables({ after: cursorOf(1, 2) })));
    view.watch(request(gridVariables({ after: cursorOf(1, 2) }), 'fetchUserCards', 9), {});
    view.stop();
    expect(redrives).toHaveLength(2);
    expect(redrives[1]?.variables).toEqual(gridVariables({ after: null }));
    expect(redrives[1]?.page.request.key).toBe(9);
  });

  it('asks for nothing when it was not serving, and stops the crawl', () => {
    const { view, redrives, crawls } = rig();
    view.watch(request(gridVariables()), {});
    view.start();
    view.stop();
    expect(crawls[0]?.signal.aborted).toBe(true);
    expect(redrives).toHaveLength(0);
  });

  it('stops serving at once', async () => {
    const { view } = await served();
    view.stop();
    const asked = request(gridVariables());
    expect(view.rewrite(asked)).toBe(asked);
    expect(view.rewrite(request(gridVariables({ after: cursorOf(1, 2) }))).variables).toEqual(gridVariables({ after: null }));
  });

  it('serves a view that is started again as another private list than the first, so the old cached pages are never linked to', async () => {
    const { view, redrives, crawls, rows } = await served();
    view.stop();
    view.start();
    crawls[1]?.finish(listOf(SLUGS));
    await settle();
    view.receiveOrder({ viewId: rows.at(-1)?.viewId ?? -1, revision: 1, descending: DESCENDING, ascending: ASCENDING });
    expect(redrives.at(-1)?.variables).toEqual(gridVariables({ orderField: privateFieldOf(2), after: null }));
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges).toEqual([]);
  });

  it('can start again', async () => {
    const { view, crawls } = await served();
    view.stop();
    view.start();
    expect(crawls).toHaveLength(2);
  });
});

describe('the grid asking for another list', () => {
  it('starts over for it when the names and the user are the same and the filters are not', async () => {
    const { view, crawls, states } = await served();
    view.watch(request(gridVariables({ modifier: { include: [1] } })), {});
    expect(crawls).toHaveLength(2);
    expect(crawls[0]?.signal.aborted).toBe(true);
    expect(states.at(-1)).toEqual({ name: 'loading', loaded: 0, total: null });
    const asked = request(gridVariables({ modifier: { include: [1] } }));
    expect(view.rewrite(asked)).toBe(asked);
  });

  it('keeps following the same list when it asks again for a later page or the other direction', async () => {
    const { view, crawls } = await served();
    view.watch(request(gridVariables({ after: cursorOf(1, 2) }), 'fetchUserCards', 8), {});
    view.watch(request(gridVariables({ orderDirection: 'ASC' }), 'fetchUserCards', 9), {});
    expect(crawls).toHaveLength(1);
  });

  it('is not moved by a picker, by the lists of other users, or by a request it made itself', async () => {
    const { view, crawls } = await served();
    const picker = pickerOf(gridVariables());
    view.watch(request(picker), {});
    view.watch(request(gridVariables({ userId: 'USER:2' })), {});
    view.watch(request(gridVariables({ orderField: privateFieldOf(1) })), {});
    view.watch(request(undefined), {});
    expect(crawls).toHaveLength(1);
  });

  it('does not start anything while it is off', () => {
    const { view, crawls } = rig();
    view.watch(request(gridVariables()), {});
    view.watch(request(gridVariables({ rank: { include: ['S'] } })), {});
    expect(crawls).toHaveLength(0);
  });

  it('does not start over while there is no view, after a crawl that failed', async () => {
    const { view, crawls } = rig();
    view.watch(request(gridVariables()), {});
    view.start();
    crawls[0]?.fail();
    await settle();
    view.watch(request(gridVariables({ rank: { include: ['S'] } })), {});
    expect(crawls).toHaveLength(1);
  });
});

describe('what the site does to the inventory meanwhile', () => {
  it('stops serving after a forge, gives the grid its own list, crawls again, and serves the new list as another one', async () => {
    const { view, redrives, crawls, rows, states } = await served();
    view.handleMutation(forged());
    expect(redrives).toHaveLength(2);
    expect(redrives[1]?.variables).toEqual(gridVariables({ after: null }));
    expect(crawls).toHaveLength(2);
    expect(states.at(-1)).toEqual({ name: 'loading', loaded: 0, total: null });
    const asked = request(gridVariables());
    expect(view.rewrite(asked)).toBe(asked);
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges).toEqual([]);
    crawls[1]?.finish(listOf(['n', 'm', 'k']));
    await settle();
    view.receiveOrder({ viewId: rows.at(-1)?.viewId ?? -1, revision: 1, descending: [0, 1, 2], ascending: [2, 1, 0] });
    expect(redrives.at(-1)?.variables).toEqual(gridVariables({ orderField: privateFieldOf(2), after: null }));
    expect(slugsOf(view.answer(gridVariables({ orderField: privateFieldOf(2) })))).toEqual(['n', 'm']);
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges).toEqual([]);
  });

  it('does the same after an accepted trade or offer, a restored forge, an opened pack and a claimed drop', async () => {
    for (const mutation of [
      accepted('acceptCardTrade'),
      accepted('acceptCardOffer'),
      { operation: request({}, 'restoreForge'), data: { restoreForge: { userId: 'USER:1' } } },
      { operation: request({}, 'openCardPack'), data: { openCardPack: { cards: [] } } },
      { operation: request({}, 'claimCardDrop'), data: { claimCardDrop: { card: {} } } },
    ]) {
      const { view, crawls } = await served();
      view.handleMutation(mutation);
      expect(crawls).toHaveLength(2);
    }
  });

  it('does nothing when the action failed, was refused, or is not about the inventory', async () => {
    const { view, crawls, redrives } = await served();
    view.handleMutation({ ...forged(), error: new Error('x') });
    view.handleMutation({ operation: request({}, 'forgeCards'), data: { forgeCards: null } });
    view.handleMutation(accepted('acceptCardTrade', false));
    view.handleMutation(accepted('declineCardTrade'));
    view.handleMutation({ data: {} });
    view.handleMutation({ operation: request({}, 'forgeCards') });
    expect(crawls).toHaveLength(1);
    expect(redrives).toHaveLength(1);
  });

  it('does nothing when it is off', async () => {
    const { view, crawls } = await served();
    view.stop();
    view.handleMutation(forged());
    expect(crawls).toHaveLength(1);
  });

  it('writes a lock into the rows it will still serve, and only for that card and modifier of that user', async () => {
    const { view } = await served();
    view.handleMutation(
      locked([
        { cardId: 'id-c', modifier: 0 },
        { cardId: 'id-b', modifier: 1 },
      ])
    );
    view.handleMutation(locked([{ cardId: 'id-a', modifier: 0 }], true, 'USER:2'));
    const first = view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges;
    expect(first.map((row) => row.node.locked)).toEqual([true, false]);
    const second = view.answer(gridVariables({ orderField: privateFieldOf(1), after: cursorOf(1, 2) })).data.userCards.edges;
    expect(second.map((row) => row.node.locked)).toEqual([false, false]);
    view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }], false));
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges[0]?.node.locked).toBe(false);
  });

  it('leaves the list as it is for a lock, and does not ask the grid again', async () => {
    const { view, crawls, redrives } = await served();
    view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
    expect(crawls).toHaveLength(1);
    expect(redrives).toHaveLength(1);
  });

  describe('the pages already served', () => {
    const privateGrid = (extra: Variables = {}): Variables => gridVariables({ orderField: privateFieldOf(1), ...extra });

    it('are written again, only the one that holds a locked card, with its cursor and direction, so the grid shows the lock', async () => {
      const { view, refreshes } = await served();
      view.answer(privateGrid());
      view.answer(privateGrid({ after: cursorOf(1, 2) }));
      view.handleMutation(locked([{ cardId: 'id-e', modifier: 0 }]));
      expect(refreshes).toHaveLength(1);
      expect(refreshes[0]?.variables).toEqual(privateGrid({ orderDirection: 'DESC', after: cursorOf(1, 2) }));
      expect(refreshes[0]?.page.request.key).toBe(7);
    });

    it('start from the first page with no cursor, and keep the direction they were served in', async () => {
      const { view, refreshes } = await served();
      view.answer(privateGrid());
      view.answer(privateGrid({ orderDirection: 'ASC', after: cursorOf(1, 2) }));
      view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
      view.handleMutation(locked([{ cardId: 'id-e', modifier: 0 }], false));
      expect(refreshes.map((entry) => entry.variables)).toEqual([
        privateGrid({ orderDirection: 'DESC', after: null }),
        privateGrid({ orderDirection: 'ASC', after: cursorOf(1, 2) }),
      ]);
    });

    it('are not written for a card on a page that was not served, nor for a card of another user', async () => {
      const { view, refreshes } = await served();
      view.answer(privateGrid());
      view.handleMutation(locked([{ cardId: 'id-d', modifier: 0 }]));
      view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }], true, 'USER:2'));
      expect(refreshes).toHaveLength(0);
    });

    it('are written once for a card that sits on served pages of both directions, and once for two cards on one page', async () => {
      const { view, refreshes } = await served();
      view.answer(privateGrid());
      view.answer(privateGrid({ orderDirection: 'ASC', after: cursorOf(1, 2) }));
      view.handleMutation(locked([{ cardId: 'id-a', modifier: 0 }]));
      expect(refreshes).toHaveLength(1);
      view.handleMutation(
        locked(
          [
            { cardId: 'id-c', modifier: 0 },
            { cardId: 'id-a', modifier: 0 },
          ],
          false
        )
      );
      expect(refreshes).toHaveLength(2);
    });

    it('are forgotten when the list is replaced, and counted again once they are served again', async () => {
      const { view, refreshes, rows } = await served();
      view.answer(privateGrid());
      view.receiveOrder({ viewId: rows[0]?.viewId ?? -1, revision: 2, descending: DESCENDING, ascending: ASCENDING });
      view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
      expect(refreshes).toHaveLength(0);
      view.answer(privateGrid({ orderField: privateFieldOf(2) }));
      view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }], false));
      expect(refreshes.map((entry) => entry.variables)).toEqual([privateGrid({ orderField: privateFieldOf(2), orderDirection: 'DESC', after: null })]);
    });

    it('are not written for a lock that came while the view is not serving anything', async () => {
      const { view, refreshes } = await crawled();
      view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
      expect(refreshes).toHaveLength(0);
    });
  });

  it('leaves a request for a private list alone, its cursor included, whether the view serves or not', async () => {
    const serving = await served();
    const crawling = await crawled();
    for (const { view } of [serving, crawling]) {
      const asked = request(gridVariables({ orderField: privateFieldOf(1), after: cursorOf(1, 2) }));
      expect(view.rewrite(asked)).toBe(asked);
    }
  });

  it('crawls again for a lock that came while the list was still being crawled, because the crawl may have read the old state', () => {
    const { view, crawls } = rig();
    view.watch(request(gridVariables()), {});
    view.start();
    view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
    expect(crawls).toHaveLength(2);
    expect(crawls[0]?.signal.aborted).toBe(true);
  });

  it('ignores a lock that is not whole', async () => {
    const { view } = await served();
    view.handleMutation({
      operation: request({ input: { userId: 'USER:1', cards: 'x', locked: true } }, 'bulkUpdateUserCardLock'),
      data: { bulkUpdateUserCardLock: { success: true } },
    });
    view.handleMutation({
      operation: request({ input: { userId: 'USER:1', cards: [{ cardId: 'id-c', modifier: 0 }] } }, 'bulkUpdateUserCardLock'),
      data: { bulkUpdateUserCardLock: { success: true } },
    });
    view.handleMutation({ operation: request({}, 'bulkUpdateUserCardLock'), data: { bulkUpdateUserCardLock: { success: true } } });
    view.handleMutation({ ...locked([{ cardId: 'id-c', modifier: 0 }]), data: { bulkUpdateUserCardLock: { success: false } } });
    expect(view.answer(gridVariables({ orderField: privateFieldOf(1) })).data.userCards.edges.map((row) => row.node.locked)).toEqual([false, false]);
  });
});
