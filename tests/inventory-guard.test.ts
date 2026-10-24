import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';
import { make, pipe, subscribe } from 'wonka';
import type { Source } from 'wonka';

import type { MutationResult } from '../utils/inventory/client-hooks';
import { LIST_OPERATION, OWN_QUERY_OPTION, createListRecord, type Variables } from '../utils/inventory/list-families';
import { AUTO_REFRESH_MAX_PAGES, installInventoryGuard, planRefresh } from '../utils/inventory/inventory-guard';
import { REFRESH_POLICY } from '../utils/inventory/list-refresh';
import { LIST_LOAD_EVENT, LIST_LOADED_EVENT, readLoaded, type LoadOutcome } from '../utils/shared/list-signal';
import {
  GUARD_ATTRIBUTE,
  GUARD_READY,
  REFRESH_REQUEST_EVENT,
  REFRESH_RESULT_EVENT,
  encodeRefreshRequest,
  readRefreshResult,
  type RefreshResult,
  type RefreshScope,
} from '../utils/shared/refresh-signal';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';

const GRAPHQL = 'https://api.senkuro.me/graphql';

const splitPicker = (userId: string, after?: string): Variables => ({
  userId,
  ...(after ? { after } : {}),
  rank: { include: [], exclude: ['F'] },
  modifier: { exclude: [1] },
  animated: false,
});

const profileGrid = (userId: string): Variables => ({ userId });

const cardsGrid = (userId: string, after?: string): Variables => ({
  userId,
  ...(after ? { after } : {}),
  modifier: { include: [0] },
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
});

const request = (name: string, variables: Variables = {}): QueryRequest => ({
  key: 1,
  variables,
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: name } }] },
});

const received = (rank: string) => ({ modifier: 0, card: { id: `id-${rank}`, rank, animated: false, explicit: false } });

const forged = (userId: string, ranks: string[]): MutationResult => ({ data: { forgeCards: { userId, addUserCards: ranks.map(received) } } });

const accepted = (name: string, success = true): MutationResult => ({ data: { [name]: { success } } });

const withOperation = (result: MutationResult, name: string): MutationResult => ({ ...result, operation: request(name) });

const page = { data: { userCards: { pageInfo: { endCursor: 'c1', hasNextPage: false }, edges: [{ node: { modifier: 0, card: { id: 'c1' } } }] } } };

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

type Init = NonNullable<Parameters<Window['fetch']>[1]>;

interface Rig {
  answer?: unknown;
  mounted?: boolean;
  results?: MutationResult[];
  slow?: boolean;
  outcomes?: string[];
}

const rig = ({ answer = {}, mounted = true, results = [], slow = false, outcomes }: Rig = {}) => {
  const win = new Window({ url: 'https://senkuro.me/forge/split' });
  win.document.body.innerHTML = '<div id="app"></div>';
  const queries: { variables: Variables; options: Record<string, unknown> }[] = [];
  const reached: Variables[] = [];
  const log: string[] = [];
  const pending = [...results];
  const client: QueryClient = {
    executeQuery: (asked) => {
      reached.push(asked.variables ?? {});
      if (!outcomes) return null;
      return make<Record<string, unknown>>((observer) => {
        outcomes.forEach((cacheOutcome) => observer.next({ data: {}, stale: false, hasNext: false, operation: { context: { meta: { cacheOutcome } } } }));
        observer.complete();
        return () => undefined;
      });
    },
    executeMutation: () =>
      make<MutationResult>((observer) => {
        const next = pending.shift();
        if (next) observer.next(next);
        observer.complete();
        return () => undefined;
      }),
    query: (_document, variables, options = {}) => ({
      toPromise: async () => {
        queries.push({ variables, options });
        const index = queries.length - 1;
        log.push(`start ${String(variables.userId)}`);
        if (slow) await new Promise((resolve) => setTimeout(resolve, 15));
        if (typeof options.fetch === 'function') {
          await (options.fetch as (input: string, init: Init) => Promise<Response>)(GRAPHQL, {
            method: 'POST',
            body: JSON.stringify({ operationName: LIST_OPERATION, variables }),
          });
        }
        log.push(`end ${String(variables.userId)}`);
        return typeof answer === 'function' ? (answer as (at: number) => unknown)(index) : answer;
      },
    }),
  };
  win.fetch = (() => Promise.resolve(new Response(JSON.stringify(page)))) as unknown as typeof win.fetch;
  const mount = () => {
    (win.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: { value: client } } } };
  };
  if (mounted) mount();
  installInventoryGuard(win as unknown as Parameters<typeof installInventoryGuard>[0]);
  const respond = () => win.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: 'fetchViewer' }) });
  const browse = (variables: Variables, options?: Record<string, unknown>) => {
    const source = client.executeQuery(request(LIST_OPERATION, variables), options);
    if (typeof source === 'function')
      pipe(
        source as Source<unknown>,
        subscribe(() => undefined)
      );
    return source;
  };
  const mutate = (name: string) => (client.executeMutation(request(name)) as { toPromise(): Promise<MutationResult> }).toPromise();
  const loaded: (LoadOutcome | null)[] = [];
  win.document.addEventListener(LIST_LOADED_EVENT, (event) => loaded.push(readLoaded(event as unknown as Event)));
  const ask = () => win.document.dispatchEvent(new win.CustomEvent(LIST_LOAD_EVENT));
  const refreshed: RefreshResult[] = [];
  win.document.addEventListener(REFRESH_RESULT_EVENT, (event) => {
    const result = readRefreshResult(event as unknown as Event);
    if (result) refreshed.push(result);
  });
  const sendRefreshDetail = (detail: string) => win.document.dispatchEvent(new win.CustomEvent(REFRESH_REQUEST_EVENT, { detail } as never));
  const requestRefresh = (scope: RefreshScope) => sendRefreshDetail(encodeRefreshRequest(scope));
  return { win, queries, reached, log, loaded, refreshed, ask, requestRefresh, sendRefreshDetail, mount, respond, browse, mutate };
};

describe('planRefresh', () => {
  const families = () => {
    const record = createListRecord();
    record.record({ document: 'd', variables: splitPicker('USER:1'), options: {} });
    record.record({ document: 'd', variables: profileGrid('USER:1'), options: {} });
    record.record({ document: 'd', variables: splitPicker('USER:2'), options: {} });
    return record.families();
  };

  it('picks, after a forge, the lists of that user that exclude a received card', () => {
    const plan = planRefresh(withOperation(forged('USER:1', ['F']), 'forgeCards'), families());
    expect(plan.map((family) => family.filters)).toEqual([expect.objectContaining({ userId: 'USER:1', animated: false })]);
  });

  it('picks nothing when every list accepts what was received, or when the forge failed', () => {
    expect(planRefresh(withOperation(forged('USER:1', ['C']), 'forgeCards'), families())).toEqual([]);
    expect(planRefresh({ ...withOperation(forged('USER:1', ['F']), 'forgeCards'), error: new Error('x') }, families())).toEqual([]);
    expect(planRefresh({ operation: request('forgeCards'), data: { forgeCards: null } }, families())).toEqual([]);
  });

  it('picks every list after an accepted trade or offer, and nothing for a refusal or another operation', () => {
    expect(planRefresh(withOperation(accepted('acceptCardTrade'), 'acceptCardTrade'), families())).toHaveLength(3);
    expect(planRefresh(withOperation(accepted('acceptCardOffer'), 'acceptCardOffer'), families())).toHaveLength(3);
    expect(planRefresh(withOperation(accepted('acceptCardTrade', false), 'acceptCardTrade'), families())).toEqual([]);
    expect(planRefresh(withOperation(accepted('declineCardTrade'), 'declineCardTrade'), families())).toEqual([]);
    expect(planRefresh({ data: {} }, families())).toEqual([]);
  });
});

describe('installInventoryGuard', () => {
  it('leaves other requests exactly as they were', async () => {
    const { win, respond } = rig();
    expect(await (await respond()).json()).toEqual(page);
    await win.happyDOM.close();
  });

  it('attaches on the first response after the app has mounted, so only lists opened afterwards are recorded', async () => {
    const { win, mount, respond, browse, mutate, queries } = rig({ mounted: false, results: [withOperation(forged('USER:1', ['F']), 'forgeCards')] });
    await respond();
    mount();
    browse(splitPicker('USER:1'));
    await respond();
    browse(splitPicker('USER:1', 'c1'));
    await mutate('forgeCards');
    await settle();
    expect(queries.map((query) => query.variables.after)).toEqual([undefined, 'c1']);
    await win.happyDOM.close();
  });

  it('refreshes the lists a forge got wrong, right after the result is applied, from the network', async () => {
    const { win, respond, browse, mutate, queries } = rig({ results: [withOperation(forged('USER:1', ['F']), 'forgeCards')] });
    await respond();
    browse(splitPicker('USER:1'));
    browse(splitPicker('USER:1', 'c1'));
    browse(profileGrid('USER:1'));
    await mutate('forgeCards');
    await settle();
    expect(queries.map((query) => query.variables)).toEqual([splitPicker('USER:1'), splitPicker('USER:1', 'c1')]);
    expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
    await win.happyDOM.close();
  });

  it('does not touch lists that already accept what a forge delivered', async () => {
    const { win, respond, browse, mutate, queries } = rig({ results: [withOperation(forged('USER:1', ['C']), 'forgeCards')] });
    await respond();
    browse(splitPicker('USER:1'));
    await mutate('forgeCards');
    await settle();
    expect(queries).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('refreshes every recorded list after an accepted trade, one list after another', async () => {
    const { win, respond, browse, mutate, queries, log } = rig({ results: [withOperation(accepted('acceptCardTrade'), 'acceptCardTrade')], slow: true });
    await respond();
    browse(profileGrid('USER:1'));
    browse(splitPicker('USER:2'));
    await mutate('acceptCardTrade');
    await settle();
    await settle();
    expect(queries).toHaveLength(2);
    expect(log).toEqual(['start USER:1', 'end USER:1', 'start USER:2', 'end USER:2']);
    await win.happyDOM.close();
  });

  it('does nothing when the action failed', async () => {
    const { win, respond, browse, mutate, queries } = rig({ results: [withOperation(accepted('acceptCardOffer', false), 'acceptCardOffer')] });
    await respond();
    browse(profileGrid('USER:1'));
    await mutate('acceptCardOffer');
    await settle();
    expect(queries).toHaveLength(0);
    await win.happyDOM.close();
  });

  it('queues a second action behind the first instead of overlapping refreshes', async () => {
    const result = withOperation(accepted('acceptCardTrade'), 'acceptCardTrade');
    const { win, respond, browse, mutate, log } = rig({ results: [result, result], slow: true });
    await respond();
    browse(profileGrid('USER:1'));
    await Promise.all([mutate('acceptCardTrade'), mutate('acceptCardTrade')]);
    await settle();
    await settle();
    expect(log).toEqual(['start USER:1', 'end USER:1', 'start USER:1', 'end USER:1']);
    await win.happyDOM.close();
  });

  it('knows the cursors the site was given before its client was found, from the answers on the wire', async () => {
    const { win, mount, respond, browse, reached } = rig({ mounted: false });
    const cards = { userId: 'USER:1', modifier: { include: [0] } };
    await win.fetch(GRAPHQL, { method: 'POST', body: JSON.stringify({ operationName: LIST_OPERATION, variables: cards }) });
    mount();
    await respond();
    browse({ userId: 'USER:1', modifier: { include: [1] }, after: 'c1' });
    browse({ ...cards, after: 'c1' });
    expect(reached.map((variables) => variables.after)).toEqual([null, 'c1']);
    await win.happyDOM.close();
  });

  describe('refreshing the open lists on request', () => {
    it('marks the document ready once it has found the client, and not before', async () => {
      const { win, mount, respond } = rig({ mounted: false });
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBeNull();
      await respond();
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBeNull();
      mount();
      await respond();
      expect(win.document.documentElement.getAttribute(GUARD_ATTRIBUTE)).toBe(GUARD_READY);
      await win.happyDOM.close();
    });

    it('replays every page of the grid lists of this route and leaves the pickers alone', async () => {
      const { win, respond, browse, requestRefresh, refreshed, queries } = rig();
      await respond();
      browse(cardsGrid('USER:1'));
      browse(cardsGrid('USER:1', 'c1'));
      browse(splitPicker('USER:1'));
      requestRefresh('grid');
      await settle();
      expect(queries.map((query) => query.variables)).toEqual([cardsGrid('USER:1'), cardsGrid('USER:1', 'c1')]);
      expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
      expect(refreshed).toEqual([{ scope: 'grid', outcome: 'done' }]);
      await win.happyDOM.close();
    });

    it('replays the picker lists of this route and leaves the grid alone', async () => {
      const { win, respond, browse, requestRefresh, refreshed, queries } = rig();
      await respond();
      browse(cardsGrid('USER:1'));
      browse(splitPicker('USER:1'));
      browse(splitPicker('USER:2'));
      requestRefresh('picker');
      await settle();
      await settle();
      expect(queries.map((query) => query.variables.userId)).toEqual(['USER:1', 'USER:2']);
      expect(refreshed).toEqual([{ scope: 'picker', outcome: 'done' }]);
      await win.happyDOM.close();
    });

    it('says there is nothing to refresh when the route holds no list of that kind', async () => {
      const { win, respond, browse, requestRefresh, refreshed, queries } = rig();
      await respond();
      browse(splitPicker('USER:1'));
      requestRefresh('grid');
      browse(cardsGrid('USER:1'));
      win.happyDOM.setURL('https://senkuro.me/users/other/cards');
      requestRefresh('grid');
      await settle();
      expect(refreshed).toEqual([
        { scope: 'grid', outcome: 'nothing' },
        { scope: 'grid', outcome: 'nothing' },
      ]);
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('says there is nothing to refresh before the client was found', async () => {
      const { win, requestRefresh, refreshed } = rig({ mounted: false });
      requestRefresh('picker');
      await settle();
      expect(refreshed).toEqual([{ scope: 'picker', outcome: 'nothing' }]);
      await win.happyDOM.close();
    });

    it('says the refresh failed when a page could not be fetched', async () => {
      const { win, respond, browse, requestRefresh, refreshed } = rig({ answer: { error: new Error('429') } });
      await respond();
      browse(cardsGrid('USER:1'));
      requestRefresh('grid');
      await settle();
      expect(refreshed).toEqual([{ scope: 'grid', outcome: 'failed' }]);
      await win.happyDOM.close();
    });

    it('queues a request behind the refresh that is running', async () => {
      const { win, respond, browse, requestRefresh, refreshed, log } = rig({ slow: true });
      await respond();
      browse(cardsGrid('USER:1'));
      requestRefresh('grid');
      requestRefresh('grid');
      await settle();
      await settle();
      await settle();
      expect(log).toEqual(['start USER:1', 'end USER:1', 'start USER:1', 'end USER:1']);
      expect(refreshed).toHaveLength(2);
      await win.happyDOM.close();
    });

    it('ignores a request it cannot read', async () => {
      const { win, respond, browse, sendRefreshDetail, refreshed, queries } = rig();
      await respond();
      browse(cardsGrid('USER:1'));
      sendRefreshDetail('junk');
      sendRefreshDetail(JSON.stringify({ scope: 'all' }));
      await settle();
      expect(refreshed).toEqual([]);
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });
  });

  describe('refreshing a list the site showed from its cache', () => {
    it('refreshes every recorded page of a list when the site shows its first page from the cache', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      browse(cardsGrid('USER:1', 'c1'));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.after)).toEqual([undefined, 'c1']);
      expect(queries.every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
      await win.happyDOM.close();
    });

    it('leaves a first page the network answered alone', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['miss'] });
      await respond();
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });

    it('refreshes only the list that came from the cache', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      browse(cardsGrid('USER:2'));
      await settle();
      queries.length = 0;
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.userId)).toEqual(['USER:1']);
      await win.happyDOM.close();
    });

    it('does not queue a second refresh of a list while one is waiting, nor for the results that follow the first', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit', 'hit', 'hit'], slow: true });
      await respond();
      browse(cardsGrid('USER:1'));
      browse(cardsGrid('USER:1'));
      await settle();
      await settle();
      expect(queries).toHaveLength(1);
      browse(cardsGrid('USER:1'));
      await settle();
      await settle();
      expect(queries).toHaveLength(2);
      await win.happyDOM.close();
    });

    it('refreshes only the first page of a list that is longer than the limit', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      for (let page = 1; page <= AUTO_REFRESH_MAX_PAGES; page++) browse(cardsGrid('USER:1', `c${page}`));
      browse(cardsGrid('USER:1'));
      await settle();
      expect(queries.map((query) => query.variables.after)).toEqual([undefined]);
      await win.happyDOM.close();
    });

    it('ignores the lists the extension reads for itself', async () => {
      const { win, respond, browse, queries } = rig({ outcomes: ['hit'] });
      await respond();
      browse(cardsGrid('USER:1'), { [OWN_QUERY_OPTION]: true });
      await settle();
      expect(queries).toHaveLength(0);
      await win.happyDOM.close();
    });
  });

  describe('loading the rest of a list on request', () => {
    const page = (hasNextPage: boolean, endCursor: string | null) => ({ data: { userCards: { pageInfo: { hasNextPage, endCursor } } } });
    const everything = page(false, null);
    const afterRefresh = (answers: unknown[]) => (index: number) => answers[index - 1];
    const ownOf = (queries: { variables: Variables; options: Record<string, unknown> }[]) =>
      queries.filter((query) => query.options[OWN_QUERY_OPTION] === true);

    it('refreshes the list the site asked for last, then reads it and says it is complete', async () => {
      const { win, respond, browse, ask, loaded, queries } = rig({ answer: everything });
      await respond();
      browse(profileGrid('USER:1'));
      ask();
      await settle();
      expect(loaded).toEqual(['complete']);
      expect(queries.map((query) => query.variables)).toEqual([profileGrid('USER:1'), profileGrid('USER:1')]);
      expect(queries.map((query) => query.options.requestPolicy)).toEqual([REFRESH_POLICY, 'cache-first']);
      expect(queries.map((query) => query.options[OWN_QUERY_OPTION])).toEqual([undefined, true]);
      await win.happyDOM.close();
    });

    it('refreshes every page the site loaded before it pages on', async () => {
      const { win, respond, browse, ask, loaded, queries } = rig({ answer: everything });
      await respond();
      browse(profileGrid('USER:1'));
      browse({ ...profileGrid('USER:1'), after: 'c1' });
      ask();
      await settle();
      await settle();
      expect(loaded).toEqual(['complete']);
      expect(queries.slice(0, 2).map((query) => query.variables.after)).toEqual([undefined, 'c1']);
      expect(queries.slice(0, 2).every((query) => query.options.requestPolicy === REFRESH_POLICY)).toBe(true);
      expect(ownOf(queries)).toHaveLength(1);
      await win.happyDOM.close();
    });

    it('pages on from the end cursor until the last page, then says it is complete', async () => {
      const answers = [page(true, 'c1'), page(true, 'c2'), everything];
      const { win, respond, browse, ask, loaded, queries } = rig({ answer: afterRefresh(answers) });
      await respond();
      browse(profileGrid('USER:1'));
      ask();
      await settle();
      expect(loaded).toEqual(['complete']);
      const own = ownOf(queries);
      expect(own.map((query) => query.variables.after)).toEqual([undefined, 'c1', 'c2']);
      expect(own.map((query) => query.options.requestPolicy)).toEqual(['cache-first', 'network-only', 'network-only']);
      await win.happyDOM.close();
    });

    it('still loads the rest when the refresh of the list failed', async () => {
      const { win, respond, browse, ask, loaded, queries } = rig({ answer: (index: number) => (index === 0 ? { error: new Error('429') } : everything) });
      await respond();
      browse(profileGrid('USER:1'));
      ask();
      await settle();
      expect(loaded).toEqual(['complete']);
      expect(ownOf(queries)).toHaveLength(1);
      await win.happyDOM.close();
    });

    it('answers no at once when the app is not up yet', async () => {
      const { win, ask, loaded } = rig({ mounted: false });
      ask();
      expect(loaded).toEqual(['partial']);
      await win.happyDOM.close();
    });

    it('answers no when no list was asked for yet', async () => {
      const { win, respond, ask, loaded } = rig({ answer: everything });
      await respond();
      ask();
      await settle();
      expect(loaded).toEqual(['partial']);
      await win.happyDOM.close();
    });

    it('takes a new request the moment it has answered', async () => {
      const { win, respond, browse, ask, loaded } = rig({ answer: everything });
      await respond();
      browse(profileGrid('USER:1'));
      let shouldAskAgain = true;
      win.document.addEventListener(LIST_LOADED_EVENT, () => {
        if (shouldAskAgain) ask();
        shouldAskAgain = false;
      });
      ask();
      await settle();
      expect(loaded).toEqual(['complete', 'complete']);
      await win.happyDOM.close();
    });

    it('does not start a second load while one is running, and takes the next one once it has answered', async () => {
      const { win, respond, browse, ask, loaded, queries } = rig({ answer: everything, slow: true });
      await respond();
      browse(profileGrid('USER:1'));
      ask();
      ask();
      await settle();
      await settle();
      expect(loaded).toEqual(['complete']);
      expect(ownOf(queries)).toHaveLength(1);
      ask();
      await settle();
      await settle();
      expect(loaded).toEqual(['complete', 'complete']);
      await win.happyDOM.close();
    });
  });

  it('keeps working when the site client cannot be found', async () => {
    const { win, respond } = rig({ mounted: false });
    expect((await respond()).status).toBe(200);
    expect((await respond()).status).toBe(200);
    await win.happyDOM.close();
  });
});
