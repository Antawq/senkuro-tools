import { describe, expect, it } from 'vitest';

import { recordLists } from '../utils/inventory/client-hooks';
import { createCursorLedger, guardCursors, repairRequest } from '../utils/inventory/list-cursors';
import { LIST_OPERATION, type PageRequest, type Variables } from '../utils/inventory/list-families';
import type { QueryClient, QueryRequest } from '../utils/shared/urql-client';

const cards = (after?: string | null): Variables => ({
  userId: 'USER:1',
  modifier: { include: [0] },
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
  ...(after === undefined ? {} : { after }),
});

const shards = (after?: string | null): Variables => ({ ...cards(after), modifier: { include: [1] } });

const request = (variables: Variables | undefined, name = LIST_OPERATION): QueryRequest => ({
  key: 7,
  ...(variables ? { variables } : {}),
  query: { definitions: [{ kind: 'OperationDefinition', name: { value: name } }] },
});

describe('createCursorLedger', () => {
  it('calls a cursor foreign only when another list issued it', () => {
    const ledger = createCursorLedger();
    ledger.learn(cards(), 'c1');
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    expect(ledger.isForeign(cards('c1'))).toBe(false);
    expect(ledger.isForeign(shards('never-seen'))).toBe(false);
  });

  it('leaves alone requests without a usable cursor', () => {
    const ledger = createCursorLedger();
    ledger.learn(cards(), 'c1');
    for (const variables of [shards(), shards(null), shards(''), { ...shards(), after: 5 }]) expect(ledger.isForeign(variables)).toBe(false);
  });

  it('keeps a cursor that two lists have both issued valid for both', () => {
    const ledger = createCursorLedger();
    ledger.learn(cards(), 'c1');
    ledger.learn(shards(), 'c1');
    expect(ledger.isForeign(cards('c1'))).toBe(false);
    expect(ledger.isForeign(shards('c1'))).toBe(false);
    expect(ledger.isForeign({ ...cards('c1'), userId: 'USER:2' })).toBe(true);
  });

  it('tells lists apart by filters and order, not by key order or by the cursor itself', () => {
    const ledger = createCursorLedger();
    ledger.learn({ orderField: 'CREATED_AT', modifier: { include: [0] }, userId: 'USER:1' }, 'c1');
    expect(ledger.isForeign({ userId: 'USER:1', modifier: { include: [0] }, orderField: 'CREATED_AT', after: 'c1' })).toBe(false);
    expect(ledger.isForeign({ ...cards('c1'), orderDirection: 'ASC' })).toBe(true);
    expect(ledger.isForeign({ ...cards('c1'), rank: { include: ['S'] } })).toBe(true);
  });

  it('ignores a cursor that is not a non-empty string', () => {
    const ledger = createCursorLedger();
    for (const bad of [null, undefined, '', 5, {}]) ledger.learn(cards(), bad);
    expect(ledger.isForeign(shards('5'))).toBe(false);
    expect(ledger.isForeign(shards(''))).toBe(false);
    expect(ledger.isForeign(shards('[object Object]'))).toBe(false);
  });

  it('forgets the oldest cursors past its limit, which only makes it trust more', () => {
    const ledger = createCursorLedger(2);
    ledger.learn(cards(), 'c1');
    ledger.learn(cards(), 'c2');
    ledger.learn(cards(), 'c3');
    expect(ledger.isForeign(shards('c1'))).toBe(false);
    expect(ledger.isForeign(shards('c2'))).toBe(true);
    expect(ledger.isForeign(shards('c3'))).toBe(true);
  });

  it('counts a cursor that is learned again as fresh', () => {
    const ledger = createCursorLedger(2);
    ledger.learn(cards(), 'c1');
    ledger.learn(cards(), 'c2');
    ledger.learn(cards(), 'c1');
    ledger.learn(cards(), 'c3');
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    expect(ledger.isForeign(shards('c2'))).toBe(false);
  });
});

describe('repairRequest', () => {
  it('starts a list over when it was asked for with another list cursor, changing nothing else', () => {
    const ledger = createCursorLedger();
    ledger.learn(cards(), 'c1');
    const asked = request(shards('c1'));
    const fixed = repairRequest(asked, ledger);
    expect(fixed.variables).toEqual(shards(null));
    expect(fixed.key).toBe(asked.key);
    expect(fixed.query).toBe(asked.query);
    expect(asked.variables).toEqual(shards('c1'));
  });

  it('returns the same request when the cursor is its own, unknown, missing, or the operation is another one', () => {
    const ledger = createCursorLedger();
    ledger.learn(cards(), 'c1');
    for (const asked of [request(cards('c1')), request(shards('unknown')), request(shards()), request(undefined), request(shards('c1'), 'fetchViewer')]) {
      expect(repairRequest(asked, ledger)).toBe(asked);
    }
  });
});

interface Calls {
  asked: { request: QueryRequest; options: Record<string, unknown> | undefined }[];
}

const clientRecording = () => {
  const calls: Calls = { asked: [] };
  const client: QueryClient = {
    executeQuery(asked, options) {
      calls.asked.push({ request: asked, options });
      return 'source';
    },
    executeMutation: () => null,
    query: () => ({ toPromise: () => Promise.resolve({}) }),
  };
  return { client, calls };
};

const knowing = (...pairs: [Variables, string][]) => {
  const ledger = createCursorLedger();
  pairs.forEach(([variables, cursor]) => ledger.learn(variables, cursor));
  return ledger;
};

describe('guardCursors', () => {
  it('sends a list that asks with the cursor of another list from its first page, changing nothing else', () => {
    const { client, calls } = clientRecording();
    expect(guardCursors(client, undefined, knowing([cards(), 'c1']))).toBe(true);
    const asked = request(shards('c1'));
    expect(client.executeQuery(asked, { requestPolicy: 'cache-first' })).toBe('source');
    expect(calls.asked[0]?.request.variables).toEqual(shards(null));
    expect(calls.asked[0]?.request.key).toBe(asked.key);
    expect(calls.asked[0]?.options).toEqual({ requestPolicy: 'cache-first' });
    expect(asked.variables).toEqual(shards('c1'));
  });

  it('lets a list continue with its own cursor, and asks with a cursor nobody gave out as it is', () => {
    const { client, calls } = clientRecording();
    guardCursors(client, undefined, knowing([cards(), 'c1']));
    client.executeQuery(request(cards('c1')));
    client.executeQuery(request(shards('unknown')));
    expect(calls.asked.map((entry) => entry.request.variables)).toEqual([cards('c1'), shards('unknown')]);
  });

  it('reports each dropped cursor with the variables it was dropped from', () => {
    const { client } = clientRecording();
    const dropped: Variables[] = [];
    guardCursors(client, (variables) => dropped.push(variables), knowing([cards(), 'c1']));
    client.executeQuery(request(shards('c1')));
    client.executeQuery(request(cards('c1')));
    expect(dropped).toEqual([shards('c1')]);
  });

  it('leaves other operations and requests without variables as they are', () => {
    const { client, calls } = clientRecording();
    guardCursors(client, undefined, knowing([cards(), 'c1']));
    const other = request({ ...shards('c1') }, 'fetchViewer');
    const bare = request(undefined);
    client.executeQuery(other);
    client.executeQuery(bare);
    expect(calls.asked[0]?.request).toBe(other);
    expect(calls.asked[1]?.request).toBe(bare);
  });

  it('hands back whatever the client returns, untouched', () => {
    const client = clientRecording().client;
    const plain = { not: 'a source' };
    client.executeQuery = () => plain;
    expect(guardCursors(client)).toBe(true);
    expect(client.executeQuery(request(cards()))).toBe(plain);
  });

  it('survives a throwing report callback', () => {
    const { client, calls } = clientRecording();
    guardCursors(
      client,
      () => {
        throw new Error('boom');
      },
      knowing([cards(), 'c1'])
    );
    expect(() => client.executeQuery(request(shards('c1')))).not.toThrow();
    expect(calls.asked[0]?.request.variables).toEqual(shards(null));
  });

  it('wraps a client once and gives up quietly on one that cannot be changed', () => {
    const twice = clientRecording();
    const reported: string[] = [];
    const ledger = knowing([cards(), 'c1']);
    expect(guardCursors(twice.client, () => reported.push('first'), ledger)).toBe(true);
    expect(guardCursors(twice.client, () => reported.push('second'), ledger)).toBe(true);
    twice.client.executeQuery(request(shards('c1')));
    expect(reported).toEqual(['first']);
    expect(twice.calls.asked).toHaveLength(1);
    const frozen = clientRecording().client;
    Object.freeze(frozen);
    expect(guardCursors(frozen)).toBe(false);
  });

  it('is seen by the list record before it records, so a replay never carries a foreign cursor', () => {
    const { client, calls } = clientRecording();
    const pages: PageRequest[] = [];
    recordLists(client, (page) => pages.push(page), new WeakSet());
    guardCursors(client, undefined, knowing([cards(), 'c1']));
    client.executeQuery(request(shards('c1')));
    expect(pages.map((page) => page.variables)).toEqual([shards(null)]);
    expect(calls.asked[0]?.request.variables).toEqual(shards(null));
  });

  it('keeps a replay that carries a cursor of its own list', () => {
    const { client, calls } = clientRecording();
    const pages: PageRequest[] = [];
    recordLists(client, (page) => pages.push(page), new WeakSet());
    guardCursors(client, undefined, knowing([cards(), 'c1']));
    client.executeQuery(request(cards('c1')));
    expect(pages.map((page) => page.variables)).toEqual([cards('c1')]);
    expect(calls.asked[0]?.request.variables).toEqual(cards('c1'));
  });
});
