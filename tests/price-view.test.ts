import { describe, expect, it } from 'vitest';

import { Client, gql, makeErrorResult, makeResult, type Operation, type OperationResult } from '@urql/core';

import type { Variables } from '../utils/inventory/list-families';
import type { Row } from '../utils/inventory/price-crawl';
import { createPrivateCursor } from '../utils/inventory/price-private';
import { createPriceView, createViewCounters, type PageAnswer, type ViewHost, type ViewList } from '../utils/inventory/price-view';
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

const listOperation = (variables: Variables, key = 7): Operation =>
  operations.createRequestOperation('query', { key, query: LIST, variables }, { suspense: true });

const mutationOf = (name: string, variables: Variables, data: Record<string, unknown> | null, error?: Error): OperationResult => {
  const operation = operations.createRequestOperation('mutation', {
    key: 1,
    query: gql(`mutation ${name}($input: ID) { ${name}(input: $input) { success } }`),
    variables,
  });
  return error ? makeErrorResult(operation, error) : makeResult(operation, { data });
};

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
  operation: Operation;
  report: (loaded: number, total: number | null) => void;
  signal: AbortSignal;
  finish: (list: ViewList | null) => void;
  fail: () => void;
}

const rig = ({ isReady = true, scope = 'grid' }: { isReady?: boolean; scope?: ListScope } = {}) => {
  const states: PriceState[] = [];
  const rows: PriceRows[] = [];
  const redrives: Operation[] = [];
  const crawls: Crawl[] = [];
  const host: ViewHost = {
    isReady: () => isReady,
    crawl: (operation, report, signal) =>
      new Promise((finish, reject) => {
        crawls.push({ operation, report, signal, finish, fail: () => reject(new Error('crawl failed')) });
      }),
    redrive: (operation) => void redrives.push(operation),
    publishState: (state) => void states.push(state),
    publishRows: (sent) => void rows.push(sent),
    debug: () => undefined,
  };
  return { view: createPriceView(host, { scope, counters: createViewCounters() }), states, rows, redrives, crawls };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const crawled = async (slugs = SLUGS) => {
  const harness = rig();
  harness.view.watch(listOperation(gridVariables()));
  harness.view.start();
  harness.crawls[0]?.finish(listOf(slugs));
  await settle();
  return harness;
};

const served = async (variables: Variables = gridVariables()) => {
  const harness = rig();
  harness.view.watch(listOperation(variables));
  harness.view.start();
  harness.crawls[0]?.finish(listOf(SLUGS));
  await settle();
  harness.view.receiveOrder({ viewId: harness.rows[0]?.viewId ?? -1, revision: 1, descending: DESCENDING, ascending: ASCENDING });
  return harness;
};

const slugsOf = (answer: PageAnswer | null): string[] => (answer?.userCards.edges ?? []).map((row) => String(row.node.card?.slug));

const lockedOf = (answer: PageAnswer | null): unknown[] => (answer?.userCards.edges ?? []).map((row) => row.node.locked);

const forged = (): OperationResult => mutationOf('forgeCards', { input: {} }, { forgeCards: { userId: 'USER:1' } });

const accepted = (name = 'acceptCardTrade', success = true): OperationResult => mutationOf(name, {}, { [name]: { success } });

const locked = (cards: { cardId: string; modifier: number }[], isLocked = true, userId = 'USER:1'): OperationResult =>
  mutationOf('bulkUpdateUserCardLock', { input: { userId, cards, locked: isLocked } }, { bulkUpdateUserCardLock: { success: true } });

describe('starting', () => {
  it('says it is unavailable when no list was asked for yet, and when the page cannot run it', () => {
    const noList = rig();
    noList.view.start();
    expect(noList.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
    expect(noList.crawls).toHaveLength(0);
    const notReady = rig({ isReady: false });
    notReady.view.watch(listOperation(gridVariables()));
    notReady.view.start();
    expect(notReady.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
    expect(notReady.crawls).toHaveLength(0);
  });

  it('crawls the grid and never a picker the page asked for after it, since only the grid is served', () => {
    const picker = { userId: 'USER:1', modifier: { exclude: [1] }, rank: { include: [], exclude: ['F'] } };
    const withGrid = rig();
    withGrid.view.watch(listOperation(gridVariables(), 1));
    withGrid.view.watch(listOperation(picker, 2));
    withGrid.view.start();
    expect(withGrid.crawls).toHaveLength(1);
    expect(withGrid.crawls[0]?.operation.key).toBe(1);
    const onlyPicker = rig();
    onlyPicker.view.watch(listOperation(picker, 3));
    onlyPicker.view.start();
    expect(onlyPicker.crawls).toHaveLength(0);
    expect(onlyPicker.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
  });

  it('crawls the list the site asked for last and says it is loading, and how far it is', () => {
    const { view, states, crawls } = rig();
    view.watch(listOperation(gridVariables({ rank: { include: ['S'] } }), 1));
    view.watch(listOperation(gridVariables(), 2));
    view.start();
    expect(crawls).toHaveLength(1);
    expect(crawls[0]?.operation.key).toBe(2);
    expect(crawls[0]?.operation.context.suspense).toBe(true);
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
    harness.view.watch(listOperation(gridVariables()));
    harness.view.start();
    harness.crawls[0]?.finish({ ...listOf(['a']), rows: [rowOf('a'), { node: { modifier: 0, card: { id: 'x' } } }] });
    await settle();
    expect(harness.rows[0]?.slugs).toEqual(['a', null]);
  });

  it('says it is unavailable when the crawl cannot start, and failed when it fails or finds nothing', async () => {
    const cannot = rig();
    cannot.view.watch(listOperation(gridVariables()));
    cannot.view.start();
    cannot.crawls[0]?.finish(null);
    await settle();
    expect(cannot.states.at(-1)).toEqual({ name: 'unavailable', loaded: 0, total: null });
    const broken = rig();
    broken.view.watch(listOperation(gridVariables()));
    broken.view.start();
    broken.crawls[0]?.fail();
    await settle();
    expect(broken.states.at(-1)).toEqual({ name: 'failed', loaded: 0, total: null });
    const empty = rig();
    empty.view.watch(listOperation(gridVariables()));
    empty.view.start();
    empty.crawls[0]?.finish(listOf([]));
    await settle();
    expect(empty.states.at(-1)).toEqual({ name: 'failed', loaded: 0, total: null });
    expect(empty.rows).toHaveLength(0);
  });

  it('forgets a crawl that was left for another one', async () => {
    const { view, crawls, rows, states } = rig();
    view.watch(listOperation(gridVariables()));
    view.start();
    view.watch(listOperation(gridVariables({ rank: { include: ['S'] } })));
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
    const asked = listOperation(gridVariables());
    expect(view.answer(asked)).toBeNull();
    expect(view.forwarded(asked)).toBe(asked);
  });

  it('serves from the moment the order has come: says so, and asks the grid again, which it then answers itself', async () => {
    const { view, states, redrives } = await served();
    expect(states.at(-1)).toEqual({ name: 'ready', loaded: 5, total: 5 });
    expect(redrives).toHaveLength(1);
    expect(redrives[0]?.key).toBe(7);
    expect(slugsOf(view.answer(redrives[0]!))).toEqual(['c', 'a']);
    expect(slugsOf(view.answer(listOperation(gridVariables({ after: 'UgECAA_YJe18' }))))).toEqual(['c', 'a']);
  });

  it('keeps the direction the site asks for and the cursor of the version it serves', async () => {
    const { view } = await served();
    expect(slugsOf(view.answer(listOperation(gridVariables({ orderDirection: 'ASC', after: createPrivateCursor(1, 2) }))))).toEqual(['d', 'b', 'e', 'a']);
  });

  it('answers every row up to the end of the page asked for, with the type names the server used and a cursor for the next, as the cache would have merged them', async () => {
    const { view } = await served();
    const first = view.answer(listOperation(gridVariables()));
    expect(slugsOf(first)).toEqual(['c', 'a']);
    expect(first?.userCards.__typename).toBe('ConnectionOfCards');
    expect(first?.userCards.pageInfo).toEqual({ __typename: 'PageInfoOfCards', hasNextPage: true, endCursor: createPrivateCursor(1, 2) });
    const second = view.answer(listOperation(gridVariables({ after: createPrivateCursor(1, 2) })));
    expect(slugsOf(second)).toEqual(['c', 'a', 'e', 'b']);
    expect(second?.userCards.pageInfo).toMatchObject({ hasNextPage: true, endCursor: createPrivateCursor(1, 4) });
    const last = view.answer(listOperation(gridVariables({ after: createPrivateCursor(1, 4) })));
    expect(slugsOf(last)).toEqual(['c', 'a', 'e', 'b', 'd']);
    expect(last?.userCards.pageInfo).toMatchObject({ hasNextPage: false, endCursor: null });
  });

  it('answers the rows as they were crawled, the same objects, so nothing the card needs is lost', async () => {
    const { view, crawls } = await served();
    expect(crawls).toHaveLength(1);
    expect(view.answer(listOperation(gridVariables()))?.userCards.edges[0]).toEqual(rowOf('c'));
  });

  it('answers the other way round for the other direction of the site', async () => {
    const { view } = await served();
    expect(slugsOf(view.answer(listOperation(gridVariables({ orderDirection: 'ASC' }))))).toEqual(['d', 'b']);
  });

  it('starts over for a cursor of another version or of the server, instead of serving the middle of another list', async () => {
    const { view } = await served();
    for (const after of [createPrivateCursor(0, 2), createPrivateCursor(9, 2), 'UgECAA_YJe18', 'senkutools:price:broken']) {
      expect(slugsOf(view.answer(listOperation(gridVariables({ after }))))).toEqual(['c', 'a']);
    }
  });

  it('leaves alone the lists that are not the one it serves: another filter, another field, other names, another user', async () => {
    const { view } = await served();
    for (const variables of [
      gridVariables({ modifier: { include: [1] } }),
      gridVariables({ orderField: 'RANK' }),
      pickerOf(gridVariables()),
      gridVariables({ userId: 'USER:2' }),
      gridVariables({ animated: false }),
    ]) {
      const asked = listOperation(variables);
      expect(view.answer(asked)).toBeNull();
      expect(view.forwarded(asked)).toBe(asked);
    }
  });

  it('leaves a request without variables alone', async () => {
    const { view } = await served();
    const asked = listOperation({});
    expect(view.answer(asked)).toBeNull();
    expect(view.forwarded(asked)).toBe(asked);
  });

  it('turns a private cursor into the start of the real list when it is not serving that list, keeping the key', async () => {
    const { view } = await crawled();
    const sent = view.forwarded(listOperation(gridVariables({ after: createPrivateCursor(1, 4) })));
    expect(sent.variables).toEqual(gridVariables({ after: null }));
    expect(sent.key).toBe(7);
  });
});

describe('a list it does not serve', () => {
  it('gets no answer from it, so the site answers it, whatever was asked', async () => {
    const nothing = rig();
    expect(nothing.view.answer(listOperation(gridVariables()))).toBeNull();
    const crawling = await crawled();
    expect(crawling.view.answer(listOperation(gridVariables()))).toBeNull();
    const { view } = await served();
    for (const variables of [gridVariables({ orderField: 'RANK' }), gridVariables({ userId: 'USER:2' }), {}]) {
      expect(view.answer(listOperation(variables))).toBeNull();
    }
  });

  it('gets no answer after the view stopped', async () => {
    const { view } = await served();
    view.stop();
    expect(view.answer(listOperation(gridVariables()))).toBeNull();
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
    view.watch(listOperation(gridVariables()));
    view.start();
    view.receiveOrder({ viewId: 1, revision: 1, descending: [], ascending: [] });
    expect(redrives).toHaveLength(0);
  });

  it('is replaced by a newer one for the same list under a new version, and the grid is asked again', async () => {
    const { view, redrives, rows } = await served();
    view.receiveOrder({ viewId: rows[0]?.viewId ?? -1, revision: 2, descending: ASCENDING, ascending: DESCENDING });
    expect(redrives).toHaveLength(2);
    expect(slugsOf(view.answer(listOperation(gridVariables())))).toEqual(['d', 'b']);
    expect(slugsOf(view.answer(listOperation(gridVariables({ after: createPrivateCursor(1, 2) }))))).toEqual(['d', 'b']);
    expect(view.answer(listOperation(gridVariables()))?.userCards.pageInfo.endCursor).toBe(createPrivateCursor(2, 2));
  });

  it('is dropped when it comes for a view that was left for another', async () => {
    const { view, rows, redrives, crawls } = await crawled();
    view.watch(listOperation(gridVariables({ modifier: { include: [1] } })));
    crawls[1]?.finish(listOf(['x']));
    await settle();
    view.receiveOrder({ viewId: rows[0]?.viewId ?? -1, revision: 1, descending: DESCENDING, ascending: ASCENDING });
    expect(redrives).toHaveLength(0);
  });
});

describe('stopping', () => {
  it('asks the grid again when it was serving, and the request then goes to the site from the first page of the real list', async () => {
    const { view, redrives } = await served();
    view.watch(listOperation(gridVariables({ after: createPrivateCursor(1, 2) }), 9));
    view.stop();
    expect(redrives).toHaveLength(2);
    expect(redrives[1]?.key).toBe(9);
    expect(view.forwarded(redrives[1]!).variables).toEqual(gridVariables({ after: null }));
  });

  it('asks for nothing when it was not serving, and stops the crawl', () => {
    const { view, redrives, crawls } = rig();
    view.watch(listOperation(gridVariables()));
    view.start();
    view.stop();
    expect(crawls[0]?.signal.aborted).toBe(true);
    expect(redrives).toHaveLength(0);
  });

  it('stops serving at once', async () => {
    const { view } = await served();
    view.stop();
    expect(view.answer(listOperation(gridVariables()))).toBeNull();
    expect(view.forwarded(listOperation(gridVariables({ after: createPrivateCursor(1, 2) }))).variables).toEqual(gridVariables({ after: null }));
  });

  it('serves a view that is started again under another version, so a cursor of the first one starts over', async () => {
    const { view, crawls, rows } = await served();
    view.stop();
    view.start();
    crawls[1]?.finish(listOf(SLUGS));
    await settle();
    view.receiveOrder({ viewId: rows.at(-1)?.viewId ?? -1, revision: 1, descending: DESCENDING, ascending: ASCENDING });
    expect(slugsOf(view.answer(listOperation(gridVariables({ after: createPrivateCursor(1, 2) }))))).toEqual(['c', 'a']);
    expect(slugsOf(view.answer(listOperation(gridVariables({ after: createPrivateCursor(2, 2) }))))).toEqual(['c', 'a', 'e', 'b']);
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
    view.watch(listOperation(gridVariables({ modifier: { include: [1] } })));
    expect(crawls).toHaveLength(2);
    expect(crawls[0]?.signal.aborted).toBe(true);
    expect(states.at(-1)).toEqual({ name: 'loading', loaded: 0, total: null });
    expect(view.answer(listOperation(gridVariables({ modifier: { include: [1] } })))).toBeNull();
  });

  it('keeps following the same list when it asks again for a later page or the other direction', async () => {
    const { view, crawls } = await served();
    view.watch(listOperation(gridVariables({ after: createPrivateCursor(1, 2) }), 8));
    view.watch(listOperation(gridVariables({ orderDirection: 'ASC' }), 9));
    expect(crawls).toHaveLength(1);
  });

  it('is not moved by a picker, by the lists of other users, or by a request without variables', async () => {
    const { view, crawls } = await served();
    view.watch(listOperation(pickerOf(gridVariables())));
    view.watch(listOperation(gridVariables({ userId: 'USER:2' })));
    view.watch(listOperation({}));
    expect(crawls).toHaveLength(1);
  });

  it('does not start anything while it is off', () => {
    const { view, crawls } = rig();
    view.watch(listOperation(gridVariables()));
    view.watch(listOperation(gridVariables({ rank: { include: ['S'] } })));
    expect(crawls).toHaveLength(0);
  });

  it('does not start over while there is no view, after a crawl that failed', async () => {
    const { view, crawls } = rig();
    view.watch(listOperation(gridVariables()));
    view.start();
    crawls[0]?.fail();
    await settle();
    view.watch(listOperation(gridVariables({ rank: { include: ['S'] } })));
    expect(crawls).toHaveLength(1);
  });
});

describe('what the site does to the inventory meanwhile', () => {
  it('stops serving after a forge, gives the grid its own list, crawls again, and serves the new list under a new version', async () => {
    const { view, redrives, crawls, rows, states } = await served();
    view.handleMutation(forged());
    expect(redrives).toHaveLength(2);
    expect(crawls).toHaveLength(2);
    expect(states.at(-1)).toEqual({ name: 'loading', loaded: 0, total: null });
    expect(view.answer(listOperation(gridVariables()))).toBeNull();
    crawls[1]?.finish(listOf(['n', 'm', 'k']));
    await settle();
    view.receiveOrder({ viewId: rows.at(-1)?.viewId ?? -1, revision: 1, descending: [0, 1, 2], ascending: [2, 1, 0] });
    expect(redrives).toHaveLength(3);
    expect(slugsOf(view.answer(listOperation(gridVariables())))).toEqual(['n', 'm']);
    expect(view.answer(listOperation(gridVariables()))?.userCards.pageInfo.endCursor).toBe(createPrivateCursor(2, 2));
  });

  it('does the same after an accepted trade or offer, a restored forge, an opened pack and a claimed drop', async () => {
    for (const mutation of [
      accepted('acceptCardTrade'),
      accepted('acceptCardOffer'),
      mutationOf('restoreForge', {}, { restoreForge: { userId: 'USER:1' } }),
      mutationOf('openCardPack', {}, { openCardPack: { cards: [] } }),
      mutationOf('claimCardDrop', {}, { claimCardDrop: { card: {} } }),
    ]) {
      const { view, crawls } = await served();
      view.handleMutation(mutation);
      expect(crawls).toHaveLength(2);
    }
  });

  it('does nothing when the action failed, was refused, or is not about the inventory', async () => {
    const { view, crawls, redrives } = await served();
    view.handleMutation(mutationOf('forgeCards', {}, null, new Error('x')));
    view.handleMutation(mutationOf('forgeCards', {}, { forgeCards: null }));
    view.handleMutation(accepted('acceptCardTrade', false));
    view.handleMutation(accepted('declineCardTrade'));
    view.handleMutation(mutationOf('forgeCards', {}, null));
    expect(crawls).toHaveLength(1);
    expect(redrives).toHaveLength(1);
  });

  it('does nothing when it is off', async () => {
    const { view, crawls } = await served();
    view.stop();
    view.handleMutation(forged());
    expect(crawls).toHaveLength(1);
  });

  it('writes a lock into the rows it serves, and only for that card and modifier of that user', async () => {
    const { view } = await served();
    view.handleMutation(
      locked([
        { cardId: 'id-c', modifier: 0 },
        { cardId: 'id-b', modifier: 1 },
      ])
    );
    view.handleMutation(locked([{ cardId: 'id-a', modifier: 0 }], true, 'USER:2'));
    expect(lockedOf(view.answer(listOperation(gridVariables({ after: createPrivateCursor(1, 2) }))))).toEqual([true, false, false, false]);
    view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }], false));
    expect(lockedOf(view.answer(listOperation(gridVariables())))[0]).toBe(false);
  });

  it('keeps the list for a lock and asks the grid again once, so its answer shows the lock', async () => {
    const { view, crawls, redrives } = await served();
    view.handleMutation(
      locked([
        { cardId: 'id-c', modifier: 0 },
        { cardId: 'id-a', modifier: 0 },
      ])
    );
    expect(crawls).toHaveLength(1);
    expect(redrives).toHaveLength(2);
    expect(redrives[1]?.key).toBe(7);
    expect(lockedOf(view.answer(redrives[1]!))).toEqual([true, true]);
  });

  it('answers a locked row as a new object, so a card that compares its row by reference draws the lock', async () => {
    const { view } = await served();
    const before = view.answer(listOperation(gridVariables()))?.userCards.edges ?? [];
    view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
    const after = view.answer(listOperation(gridVariables()))?.userCards.edges ?? [];
    expect(after[0]).not.toBe(before[0]);
    expect(after[0]?.node).not.toBe(before[0]?.node);
    expect(after[1]).toBe(before[1]);
    expect(before[0]?.node.locked).toBe(false);
  });

  it('does not ask the grid again for a lock of a card it does not hold, of another user, or while it is not serving', async () => {
    const { view, redrives } = await served();
    view.handleMutation(locked([{ cardId: 'id-z', modifier: 0 }]));
    view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }], true, 'USER:2'));
    expect(redrives).toHaveLength(1);
    const crawling = await crawled();
    crawling.view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
    expect(crawling.redrives).toHaveLength(0);
  });

  it('crawls again for a lock that came while the list was still being crawled, because the crawl may have read the old state', () => {
    const { view, crawls } = rig();
    view.watch(listOperation(gridVariables()));
    view.start();
    view.handleMutation(locked([{ cardId: 'id-c', modifier: 0 }]));
    expect(crawls).toHaveLength(2);
    expect(crawls[0]?.signal.aborted).toBe(true);
  });

  it('ignores a lock that is not whole', async () => {
    const { view, redrives } = await served();
    const success = { bulkUpdateUserCardLock: { success: true } };
    view.handleMutation(mutationOf('bulkUpdateUserCardLock', { input: { userId: 'USER:1', cards: 'x', locked: true } }, success));
    view.handleMutation(mutationOf('bulkUpdateUserCardLock', { input: { userId: 'USER:1', cards: [{ cardId: 'id-c', modifier: 0 }] } }, success));
    view.handleMutation(mutationOf('bulkUpdateUserCardLock', {}, success));
    view.handleMutation(
      mutationOf(
        'bulkUpdateUserCardLock',
        { input: { userId: 'USER:1', cards: [{ cardId: 'id-c', modifier: 0 }], locked: true } },
        { bulkUpdateUserCardLock: { success: false } }
      )
    );
    expect(lockedOf(view.answer(listOperation(gridVariables())))).toEqual([false, false]);
    expect(redrives).toHaveLength(1);
  });
});

const siteGridVariables = (extra: Variables = {}): Variables => ({
  after: null,
  userId: 'USER:1',
  orderDirection: 'DESC',
  orderField: 'CREATED_AT',
  rank: { include: [] },
  color: { include: [] },
  modifier: { include: [0] },
  animated: null,
  explicit: null,
  ...extra,
});

const windowVariables = (extra: Variables = {}): Variables => ({
  userId: 'USER:1',
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
  after: null,
  rank: { include: [], exclude: [] },
  color: { include: [] },
  modifier: { exclude: [] },
  animated: null,
  explicit: null,
  ...extra,
});

const deckVariables = (extra: Variables = {}): Variables => ({
  userId: 'USER:1',
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
  after: null,
  rank: { include: [] },
  color: { include: [] },
  modifier: { exclude: [1] },
  animated: null,
  explicit: null,
  ...extra,
});

const servedIn = async (scope: ListScope, variables: Variables) => {
  const harness = rig({ scope });
  harness.view.watch(listOperation(variables));
  harness.view.start();
  harness.crawls[0]?.finish(listOf(SLUGS));
  await settle();
  harness.view.receiveOrder({ viewId: harness.rows[0]?.viewId ?? -1, revision: 1, descending: DESCENDING, ascending: ASCENDING });
  return harness;
};

describe('the lists of the site as they are asked since the 29.10 build, the same names in every place', () => {
  it('keeps the grid on its list when a window of the same user asks for its picker with the same names', async () => {
    const { view, crawls } = await servedIn('grid', siteGridVariables());
    view.watch(listOperation(windowVariables(), 3));
    view.watch(listOperation(deckVariables(), 4));
    expect(crawls).toHaveLength(1);
    expect(view.answer(listOperation(windowVariables()))).toBeNull();
  });
});

describe('a view of the pickers', () => {
  it('crawls the picker the site asked for last and never the grid', () => {
    const { view, crawls } = rig({ scope: 'picker' });
    view.watch(listOperation(windowVariables(), 1));
    view.watch(listOperation(siteGridVariables(), 2));
    view.start();
    expect(crawls).toHaveLength(1);
    expect(crawls[0]?.operation.key).toBe(1);
    const gridOnly = rig({ scope: 'picker' });
    gridOnly.view.watch(listOperation(siteGridVariables()));
    gridOnly.view.start();
    expect(gridOnly.crawls).toHaveLength(0);
    expect(gridOnly.states).toEqual([{ name: 'unavailable', loaded: 0, total: null }]);
  });

  it('serves its window the sorted list and leaves the grid to the grid', async () => {
    const { view, redrives } = await servedIn('picker', windowVariables());
    expect(slugsOf(view.answer(redrives[0]!))).toEqual(['c', 'a']);
    expect(slugsOf(view.answer(listOperation(windowVariables())))).toEqual(['c', 'a']);
    const grid = listOperation(siteGridVariables({ after: createPrivateCursor(1, 2) }));
    expect(view.answer(grid)).toBeNull();
    expect(view.forwarded(grid)).toBe(grid);
  });

  it('follows its window to the list of another user, as the two steps of a trade window list the partner and then the own cards', async () => {
    const { view, crawls } = await servedIn('picker', windowVariables({ userId: 'USER:2' }));
    view.watch(listOperation(windowVariables({ userId: 'USER:1' })));
    expect(crawls).toHaveLength(2);
    expect((crawls[1]?.operation.variables as Variables).userId).toBe('USER:1');
  });

  it('is not moved by a picker of another kind, told apart by the fields of its filters: a window over the deck builder', async () => {
    const { view, crawls } = await servedIn('picker', deckVariables());
    view.watch(listOperation(windowVariables()));
    view.watch(listOperation(windowVariables({ userId: 'USER:2' })));
    expect(crawls).toHaveLength(1);
  });
});

describe('restarting', () => {
  it('crawls the list it serves again, gives the site its real list meanwhile, and serves the new crawl under a new version', async () => {
    const { view, redrives, crawls, rows } = await servedIn('picker', windowVariables());
    view.restart();
    expect(crawls).toHaveLength(2);
    expect(redrives).toHaveLength(2);
    expect(view.answer(listOperation(windowVariables()))).toBeNull();
    crawls[1]?.finish(listOf(['n', 'm', 'k']));
    await settle();
    view.receiveOrder({ viewId: rows.at(-1)?.viewId ?? -1, revision: 1, descending: [0, 1, 2], ascending: [2, 1, 0] });
    expect(redrives).toHaveLength(3);
    expect(slugsOf(view.answer(listOperation(windowVariables())))).toEqual(['n', 'm']);
    expect(view.answer(listOperation(windowVariables()))?.userCards.pageInfo.endCursor).toBe(createPrivateCursor(2, 2));
  });

  it('crawls in the direction of its first crawl, so equal prices keep their order, and gives back the list in the direction the site shows', async () => {
    const { view, redrives, crawls } = await servedIn('picker', windowVariables());
    view.watch(listOperation(windowVariables({ orderDirection: 'ASC', after: createPrivateCursor(1, 2) }), 9));
    view.restart();
    expect((crawls[1]?.operation.variables as Variables).orderDirection).toBe('DESC');
    expect(crawls[1]?.operation.key).toBe(9);
    expect(view.forwarded(redrives.at(-1)!).variables).toEqual(windowVariables({ orderDirection: 'ASC', after: null }));
    view.handleMutation(forged());
    expect((crawls[2]?.operation.variables as Variables).orderDirection).toBe('DESC');
  });

  it('does nothing while it is off', () => {
    const { view, crawls, redrives } = rig({ scope: 'picker' });
    view.watch(listOperation(windowVariables()));
    view.restart();
    expect(crawls).toHaveLength(0);
    expect(redrives).toHaveLength(0);
  });
});
