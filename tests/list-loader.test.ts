import { describe, expect, it } from 'vitest';

import { MAX_LOAD_PAGES, loadRest, type LoadHost } from '../utils/inventory/list-loader';
import { LIST_OPERATION, type PageRequest, type Variables } from '../utils/inventory/list-families';
import { FAST_PAGES, THROTTLED_DELAY_MS } from '../utils/shared/paging';
import type { QueryClient } from '../utils/shared/urql-client';

const GRID = { userId: 'USER:1', modifier: { include: [0] }, orderField: 'CREATED_AT', orderDirection: 'DESC' };
const queryDocument = { definitions: [{ kind: 'OperationDefinition', name: { value: LIST_OPERATION } }] };

const recorded = (variables: Variables = GRID, options: Record<string, unknown> = { suspense: true }): PageRequest => ({
  document: queryDocument,
  variables,
  options,
});

const pageInfoAnswer = (hasNextPage: boolean, endCursor: string | null) => ({ data: { userCards: { pageInfo: { hasNextPage, endCursor } } } });

interface Asked {
  queryDocument: unknown;
  after: unknown;
  options: Record<string, unknown> | undefined;
}

interface Rig {
  answers: (asked: Asked, index: number) => unknown;
  latestPage?: () => PageRequest | null;
}

const rig = ({ answers, latestPage = () => recorded() }: Rig) => {
  const asked: Asked[] = [];
  const sleeps: number[] = [];
  const client: QueryClient = {
    executeQuery: () => null,
    executeMutation: () => null,
    query(queried, variables, options) {
      const entry = { queryDocument: queried, after: variables.after, options };
      asked.push(entry);
      return { toPromise: () => Promise.resolve(answers(entry, asked.length - 1)) };
    },
  };
  const host: LoadHost = { client, latestPage, sleep: (ms) => Promise.resolve(void sleeps.push(ms)) };
  return { host, asked, sleeps };
};

const chain =
  (total: number) =>
  (_asked: Asked, index: number): unknown =>
    index === 0 ? pageInfoAnswer(total > 0, total > 0 ? 'c1' : null) : pageInfoAnswer(index < total, index < total ? `c${index + 1}` : null);

describe('loadRest', () => {
  it('reads what is loaded, then asks the network for every page after it, one after another, ending at the last', async () => {
    const { host, asked } = rig({ answers: chain(3) });
    expect(await loadRest(host)).toBe('complete');
    expect(asked.map((entry) => entry.after)).toEqual([undefined, 'c1', 'c2', 'c3']);
    expect(asked.map((entry) => entry.options?.requestPolicy)).toEqual(['cache-first', 'network-only', 'network-only', 'network-only']);
    expect(asked.every((entry) => entry.queryDocument === queryDocument && entry.options?.suspense === true)).toBe(true);
  });

  it('keeps the cursor the list was asked with when it reads what is loaded', async () => {
    const { host, asked } = rig({ answers: chain(1), latestPage: () => recorded({ ...GRID, after: 'c0' }) });
    await loadRest(host);
    expect(asked.map((entry) => entry.after)).toEqual(['c0', 'c1']);
  });

  it('asks nothing of the network when the whole list is already there', async () => {
    const { host, asked } = rig({ answers: chain(0) });
    expect(await loadRest(host)).toBe('complete');
    expect(asked).toHaveLength(1);
  });

  it('gives up when no list was ever asked for', async () => {
    const { host, asked } = rig({ answers: chain(2), latestPage: () => null });
    expect(await loadRest(host)).toBe('partial');
    expect(asked).toHaveLength(0);
  });

  it('gives up at a failed page and asks for nothing more, even when the failure came with some data', async () => {
    for (const failure of [{ error: new Error('429') }, { ...pageInfoAnswer(true, 'c3'), error: new Error('429') }]) {
      const { host, asked } = rig({ answers: (_asked, index) => (index === 2 ? failure : pageInfoAnswer(true, `c${index + 1}`)) });
      expect(await loadRest(host)).toBe('partial');
      expect(asked).toHaveLength(3);
    }
  });

  it('does not go on without a cursor to go on', async () => {
    const { host, asked } = rig({ answers: () => pageInfoAnswer(true, null) });
    expect(await loadRest(host)).toBe('partial');
    expect(asked).toHaveLength(1);
  });

  it('gives up on an answer without a list and on a query that throws', async () => {
    for (const answers of [() => ({ data: null }), () => ({ data: { userCards: { pageInfo: null } } })]) {
      expect(await loadRest(rig({ answers }).host)).toBe('partial');
    }
    const throwing = rig({ answers: chain(1) });
    throwing.host.client.query = () => ({ toPromise: () => Promise.reject(new Error('network')) });
    expect(await loadRest(throwing.host)).toBe('partial');
  });

  it('stops and says so when the site has moved on to another list, which now needs its own load', async () => {
    let current: PageRequest = recorded();
    const { host, asked } = rig({
      answers: (_asked, index) => {
        if (index === 2) current = recorded({ ...GRID, modifier: { include: [1] } });
        return pageInfoAnswer(true, `c${index + 1}`);
      },
      latestPage: () => current,
    });
    expect(await loadRest(host)).toBe('moved');
    expect(asked).toHaveLength(3);
  });

  it('keeps going when only the cursor of the same list moved on', async () => {
    let current: PageRequest = recorded();
    const { host } = rig({
      answers: (...args) => {
        current = recorded({ ...GRID, after: `c${args[1]}` });
        return chain(3)(...args);
      },
      latestPage: () => current,
    });
    expect(await loadRest(host)).toBe('complete');
  });

  it('waits between pages, fast at first and slower once the list is long', async () => {
    const { host, sleeps } = rig({ answers: chain(FAST_PAGES + 2) });
    expect(await loadRest(host)).toBe('complete');
    expect(sleeps).toHaveLength(FAST_PAGES + 1);
    expect(sleeps.slice(0, FAST_PAGES)).toEqual(Array.from({ length: FAST_PAGES }, () => 0));
    expect(sleeps.at(-1)).toBe(THROTTLED_DELAY_MS);
  });

  it('stops at the page cap instead of running forever', async () => {
    const { host, asked } = rig({ answers: (_asked, index) => pageInfoAnswer(true, `c${index + 1}`) });
    expect(await loadRest(host)).toBe('partial');
    expect(asked).toHaveLength(MAX_LOAD_PAGES + 1);
  });
});
