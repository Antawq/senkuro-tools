import { describe, expect, it } from 'vitest';

import type { Transport } from '../utils/shared/graphql';
import { CRAWL_OPERATION } from '../utils/inventory/price-document';
import { crawlList, slugOf } from '../utils/inventory/price-crawl';
import { USER_CARDS_MAX_PAGES } from '../utils/shared/paging';
import { FAST_PAGES, THROTTLED_DELAY_MS } from '../utils/shared/paging';

interface Sent {
  query: string;
  operationName: string;
  variables: Record<string, unknown>;
}

const row = (slug: string, modifier = 0) => ({
  __typename: 'UserCardEdge',
  node: { __typename: 'UserCard', quantity: 1, modifier, locked: false, card: { __typename: 'Card', id: `id-${slug}`, slug } },
});

const connection = (edges: unknown[], next: string | null, total: number | null = null) => ({
  data: {
    userCards: {
      __typename: 'UserCardConnection',
      totalCount: total,
      edges,
      pageInfo: { __typename: 'PageInfo', hasNextPage: next !== null, endCursor: next },
    },
  },
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

const serve = (answer: (sent: Sent, index: number) => Response) => {
  const sent: Sent[] = [];
  const urls: string[] = [];
  const sleeps: number[] = [];
  const transport: Transport = {
    endpoint: 'https://api.senkuro.me/graphql',
    fetch: (url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(urlOf(url));
      sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Sent);
      return Promise.resolve(answer(sent.at(-1) as Sent, sent.length - 1));
    },
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
  };
  return { sent, urls, sleeps, transport };
};

const VARIABLES = { userId: 'USER:1', modifier: { include: [0] }, orderField: 'CREATED_AT', orderDirection: 'DESC' };

describe('crawlList', () => {
  it('walks every page by its cursor with the document it was given and the variables of the list', async () => {
    const pages: Record<string, unknown> = {
      first: connection([row('a-a'), row('b-b')], 'c1', 3),
      c1: connection([row('c-c')], null, 3),
    };
    const { sent, urls, transport } = serve((request) => json(pages[(request.variables.after as string | null) ?? 'first']));
    const progress: [number, number | null][] = [];
    const crawled = await crawlList({ text: 'query X { x }', variables: VARIABLES, transport, onProgress: (loaded, total) => progress.push([loaded, total]) });
    expect(crawled.rows.map(slugOf)).toEqual(['a-a', 'b-b', 'c-c']);
    expect(sent.map((request) => request.variables)).toEqual([
      { ...VARIABLES, after: null },
      { ...VARIABLES, after: 'c1' },
    ]);
    expect(sent.every((request) => request.query === 'query X { x }' && request.operationName === CRAWL_OPERATION)).toBe(true);
    expect(urls).toEqual(['https://api.senkuro.me/graphql', 'https://api.senkuro.me/graphql']);
    expect(progress).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });

  it('keeps the type names the server uses, so the rows can be handed back as the server sent them', async () => {
    const { transport } = serve(() => json(connection([row('a-a')], null)));
    const crawled = await crawlList({ text: 'q', variables: VARIABLES, transport });
    expect(crawled).toMatchObject({ connectionType: 'UserCardConnection', pageInfoType: 'PageInfo' });
    expect(crawled.rows[0]).toEqual(row('a-a'));
  });

  it('drops a row it has seen and a row it cannot place, and keeps the same card in another modifier', async () => {
    const pages: Record<string, unknown> = {
      first: connection([row('a-a'), row('a-a'), { node: null }, null, { node: { modifier: 0 } }, row('a-a', 1)], 'c1'),
      c1: connection([row('a-a', 1), row('b-b')], null),
    };
    const { transport } = serve((request) => json(pages[(request.variables.after as string | null) ?? 'first']));
    const crawled = await crawlList({ text: 'q', variables: VARIABLES, transport });
    expect(crawled.rows.map((entry) => `${slugOf(entry)}:${String(entry.node.modifier)}`)).toEqual(['a-a:0', 'a-a:1', 'b-b:0']);
  });

  it('pauses between pages the way the other crawls do: not for the first pages, a little for the rest', async () => {
    const total = FAST_PAGES + 3;
    const { sleeps, transport } = serve((_request, index) => json(connection([row(`s-${index}`)], index + 1 < total ? `c${index + 1}` : null)));
    const crawled = await crawlList({ text: 'q', variables: VARIABLES, transport });
    expect(crawled.rows).toHaveLength(total);
    expect(sleeps).toEqual(Array.from({ length: total - 1 - FAST_PAGES }, () => THROTTLED_DELAY_MS));
  });

  it('stops with an error at the page limit instead of walking on', async () => {
    const { sent, transport } = serve((_request, index) => json(connection([row(`s-${index}`)], `c${index}`)));
    await expect(crawlList({ text: 'q', variables: VARIABLES, transport })).rejects.toMatchObject({ failure: 'limit' });
    expect(sent).toHaveLength(USER_CARDS_MAX_PAGES);
  });

  it('fails when the server answers something that is not a list, and when a request fails', async () => {
    const empty = serve(() => json({ data: { userCards: null } }));
    await expect(crawlList({ text: 'q', variables: VARIABLES, transport: empty.transport })).rejects.toMatchObject({ failure: 'decode' });
    const refused = serve(() => json({ errors: [{ message: 'no' }] }));
    await expect(crawlList({ text: 'q', variables: VARIABLES, transport: refused.transport })).rejects.toMatchObject({ failure: 'graphql' });
  });

  it('stops asking when it is told to stop', async () => {
    const controller = new AbortController();
    const { sent, transport } = serve((_request, index) => {
      if (index === 1) controller.abort();
      return json(connection([row(`s-${index}`)], `c${index}`));
    });
    await expect(crawlList({ text: 'q', variables: VARIABLES, transport, signal: controller.signal })).rejects.toMatchObject({ failure: 'network' });
    expect(sent.length).toBeLessThanOrEqual(3);
  });
});
