import { describe, expect, it } from 'vitest';

import { Client, gql, type Operation, type OperationResult } from '@urql/core';

import { createCursorLedger, cursorExchange, repairOperation, type CursorLedger } from '../utils/inventory/list-cursors';
import type { Variables } from '../utils/inventory/list-families';
import { delegateExchange } from '../utils/shared/delegate-exchange';
import { SITE_URL, createSiteClient, nameOf, type SiteAnswer } from './helpers/site-client';

const cards = (after?: string | null): Variables => ({
  userId: 'USER:1',
  modifier: { include: [0] },
  orderField: 'CREATED_AT',
  orderDirection: 'DESC',
  ...(after === undefined ? {} : { after }),
});

const shards = (after?: string | null): Variables => ({ ...cards(after), modifier: { include: [1] } });

const LIST = gql`
  query fetchUserCards($userId: ID!, $after: String) {
    userCards(first: 20, userId: $userId, after: $after) {
      edges {
        node {
          modifier
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const VIEWER = gql`
  query fetchViewer($after: String) {
    viewer {
      id
    }
  }
`;

const listAnswer = (endCursor: unknown) => ({ data: { userCards: { edges: [], pageInfo: { hasNextPage: true, endCursor } } } });

const operationOf = (variables: Variables | undefined, query = LIST): Operation =>
  new Client({ url: SITE_URL, exchanges: [] }).createRequestOperation('query', { key: 7, query, variables: variables ?? {} });

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

describe('repairOperation', () => {
  it('starts a list over when it was asked for with another list cursor, changing nothing else', () => {
    const ledger = createCursorLedger();
    ledger.learn(cards(), 'c1');
    const asked = operationOf(shards('c1'));
    const fixed = repairOperation(asked, ledger);
    expect(fixed.variables).toEqual(shards(null));
    expect(fixed.key).toBe(asked.key);
    expect(fixed.query).toBe(asked.query);
    expect(fixed.context).toEqual(asked.context);
    expect(asked.variables).toEqual(shards('c1'));
  });

  it('returns the same operation when the cursor is its own, unknown, missing, or the operation is another one', () => {
    const ledger = createCursorLedger();
    ledger.learn(cards(), 'c1');
    for (const asked of [
      operationOf(cards('c1')),
      operationOf(shards('unknown')),
      operationOf(shards()),
      operationOf(undefined, VIEWER),
      operationOf(shards('c1'), VIEWER),
    ]) {
      expect(repairOperation(asked, ledger)).toBe(asked);
    }
  });
});

const knowing = (...pairs: [Variables, string][]) => {
  const ledger = createCursorLedger();
  pairs.forEach(([variables, cursor]) => ledger.learn(variables, cursor));
  return ledger;
};

const rig = (ledger: CursorLedger = createCursorLedger(), onDrop?: (variables: Variables) => void, answer: SiteAnswer = () => listAnswer('c9')) => {
  const site = createSiteClient(answer);
  const client = new Client({ url: SITE_URL, exchanges: [cursorExchange(ledger, onDrop), delegateExchange(site.client)] });
  const siteVariables = () => site.operations.filter((operation) => operation.kind === 'query').map((operation) => operation.variables);
  const ask = (variables: Variables, query = LIST): Promise<OperationResult> => client.query(query, variables).toPromise();
  return { site, ledger, siteVariables, ask };
};

describe('cursorExchange', () => {
  it('sends a list that asks with the cursor of another list from its first page, changing nothing else, and the caller gets the answer', async () => {
    const { ask, siteVariables } = rig(knowing([cards(), 'c1']));
    const result = await ask(shards('c1'));
    expect(siteVariables()).toEqual([shards(null)]);
    expect(result.data).toEqual(listAnswer('c9').data);
    expect(result.operation.variables).toEqual(shards(null));
  });

  it('lets a list continue with its own cursor, and asks with a cursor nobody gave out as it is', async () => {
    const { ask, siteVariables } = rig(knowing([cards(), 'c1']));
    await ask(cards('c1'));
    await ask(shards('unknown'));
    expect(siteVariables()).toEqual([cards('c1'), shards('unknown')]);
  });

  it('reports each dropped cursor with the variables it was dropped from', async () => {
    const dropped: Variables[] = [];
    const { ask } = rig(knowing([cards(), 'c1']), (variables) => dropped.push(variables));
    await ask(shards('c1'));
    await ask(cards('c1'));
    expect(dropped).toEqual([shards('c1')]);
  });

  it('leaves other operations as they are', async () => {
    const { ask, site } = rig(knowing([cards(), 'c1']), undefined, () => ({ data: { viewer: { id: 'U1' } } }));
    await ask(shards('c1'), VIEWER);
    expect(
      site.operations.filter((operation) => operation.kind === 'query' && nameOf(operation) === 'fetchViewer').map((operation) => operation.variables)
    ).toEqual([shards('c1')]);
  });

  it('survives a throwing report callback', async () => {
    const { ask, siteVariables } = rig(knowing([cards(), 'c1']), () => {
      throw new Error('boom');
    });
    await expect(ask(shards('c1'))).resolves.toBeDefined();
    expect(siteVariables()).toEqual([shards(null)]);
  });

  it('learns the end cursor of a list answer with the list that asked', async () => {
    const { ask, ledger } = rig(createCursorLedger(), undefined, () => listAnswer('c1'));
    await ask(cards());
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    expect(ledger.isForeign(cards('c1'))).toBe(false);
  });

  it('learns the cursor a list asked with too, which the site handed out before the swap', async () => {
    const { ask, ledger } = rig(createCursorLedger(), undefined, () => listAnswer('c2'));
    await ask(cards('c1'));
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    expect(ledger.isForeign(shards('c2'))).toBe(true);
    expect(ledger.isForeign(cards('c1'))).toBe(false);
  });

  it('learns the end cursor of a first page the cache answered, which never went over the wire', async () => {
    const { ask, ledger } = rig(createCursorLedger(), undefined, () => ({ ...listAnswer('c20'), cacheOutcome: 'hit' }));
    await ask(cards(null));
    expect(ledger.isForeign(shards('c20'))).toBe(true);
  });

  it('hands the caller the answer whole', async () => {
    const { ask } = rig();
    expect((await ask(cards())).data).toEqual(listAnswer('c9').data);
  });

  it('learns nothing from an answer of another operation, an answer that is not a list or has no cursor, and still returns it', async () => {
    for (const data of [{ userCards: null }, listAnswer(null).data, listAnswer('').data]) {
      const { ask, ledger } = rig(createCursorLedger(), undefined, () => ({ data }));
      expect((await ask(cards())).data).toEqual(data);
      expect(ledger.isForeign(shards(''))).toBe(false);
    }
    const viewer = rig(createCursorLedger(), undefined, () => listAnswer('c1'));
    await viewer.ask({}, VIEWER);
    expect(viewer.ledger.isForeign(shards('c1'))).toBe(false);
  });

  it('passes a failed answer on as it failed and learns only the cursor it was asked with', async () => {
    const { ask, ledger } = rig(createCursorLedger(), undefined, () => ({ error: 'boom' }));
    const result = await ask(cards('c1'));
    expect(result.error?.message).toContain('boom');
    expect(ledger.isForeign(shards('c1'))).toBe(true);
    expect(ledger.isForeign(shards('c9'))).toBe(false);
  });
});
