import { describe, expect, it } from 'vitest';

import { Window } from 'happy-dom';
import { Client, gql, makeResult, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { filter, fromArray, mergeMap, never, pipe } from 'wonka';

import { searchSignal, type SearchProgress } from '../utils/search/search-event';
import { SEARCH_PAGE_SIZE, createSearchPublisher, searchExchange } from '../utils/search/search-exchange';
import { installClientSwap } from '../utils/shared/client-swap';
import { delegateExchange } from '../utils/shared/delegate-exchange';
import { createSiteClient, nameOf, SITE_URL, tick, type SiteAnswer } from './helpers/site-client';
import { firstOf, searchDocument } from './helpers/search-requests';

const TERMS = { query: 'naruto', type: 'MANGA' };

const CARDS = gql`
  query fetchUserCards($userId: ID!) {
    userCards(first: 20, userId: $userId) {
      edges {
        node {
          modifier
        }
      }
    }
  }
`;

const searchData = (...slugs: string[]) => ({ search: { edges: slugs.map((slug) => ({ node: { slug } })) } });

const rig = (answer: SiteAnswer = () => ({ data: searchData('naruto') })) => {
  const site = createSiteClient(answer);
  const signals: SearchProgress[] = [];
  const client = new Client({ url: SITE_URL, exchanges: [searchExchange((signal) => signals.push(signal)), delegateExchange(site.client)] });
  return { site, client, signals };
};

const streamingRig = (results: { stale?: boolean; data?: unknown }[], isComplete = true) => {
  const site: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation: Operation) => operation.kind !== 'teardown'),
      mergeMap((operation: Operation) => {
        const answers = results.map(({ stale, data }): OperationResult => ({ ...makeResult(operation, { data: data ?? null }), stale: stale === true }));
        return isComplete ? fromArray(answers) : never;
      })
    );
  const siteClient = new Client({ url: SITE_URL, exchanges: [site] });
  const signals: SearchProgress[] = [];
  const client = new Client({ url: SITE_URL, exchanges: [searchExchange((signal) => signals.push(signal)), delegateExchange(siteClient)] });
  return { client, signals };
};

describe('searchExchange', () => {
  it('sends the wider search to the site client and gives the caller the answer', async () => {
    const { site, client } = rig();
    const result = await client.query(searchDocument(), TERMS).toPromise();
    const [siteSearch] = site.operations.filter((operation) => operation.kind === 'query');
    expect(firstOf(siteSearch!.query)).toEqual([String(SEARCH_PAGE_SIZE), '5']);
    expect(result.data).toEqual(searchData('naruto'));
  });

  it('passes other requests to the site unchanged', async () => {
    const { site, client } = rig(() => ({ data: { userCards: { edges: [] } } }));
    const result = await client.query(CARDS, { userId: 'U1' }).toPromise();
    const [siteQuery] = site.operations.filter((operation) => operation.kind === 'query');
    expect(siteQuery?.query).toBe(CARDS);
    expect(siteQuery?.key).toBe(result.operation.key);
  });

  it('publishes a search when it starts and when its answer is in, with what was asked', async () => {
    const { client, signals } = streamingRig([{ stale: true }, { data: searchData('naruto', 'naruto-gaiden') }]);
    await client.query(searchDocument(), TERMS).toPromise();
    expect(signals).toEqual([
      { phase: 'start', ...TERMS },
      { phase: 'done', ...TERMS, settled: true, firstSlug: 'naruto' },
    ]);
  });

  it('says there is no first result when the answer holds none, or holds something unexpected', async () => {
    for (const data of [
      { search: { edges: [] } },
      { search: null },
      { search: { edges: [{ node: {} }] } },
      { search: { edges: [{ node: { slug: 5 } }] } },
      undefined,
    ]) {
      const { client, signals } = streamingRig([{ data }]);
      await client.query(searchDocument(), TERMS).toPromise();
      expect(signals.at(-1)).toEqual({ phase: 'done', ...TERMS, settled: true, firstSlug: null });
    }
  });

  it('publishes the end of a search the page gave up on', async () => {
    const { client, signals } = streamingRig([], false);
    const subscription = client.query(searchDocument(), TERMS).subscribe(() => undefined);
    await tick();
    expect(signals.map((signal) => signal.phase)).toEqual(['start']);
    subscription.unsubscribe();
    expect(signals.map((signal) => signal.phase)).toEqual(['start', 'done']);
    expect(signals.at(-1)).toEqual({ phase: 'done', ...TERMS });
  });

  it('says nothing about other operations, or about a search whose variables are unknown', async () => {
    const { client, signals } = rig(() => ({ data: { userCards: { edges: [] } } }));
    await client.query(CARDS, { userId: 'U1' }).toPromise();
    await client.query(searchDocument(), { query: 'naruto' }).toPromise();
    expect(signals).toEqual([]);
  });

  it('gives the answer of a search the site got under a fresh key to the caller who asked', async () => {
    const { site, client } = rig();
    const results: OperationResult[] = [];
    const subscription = client.query(searchDocument(), TERMS).subscribe((result) => results.push(result));
    await tick();
    const [siteSearch] = site.operations.filter((operation) => operation.kind === 'query');
    expect(siteSearch?.key).not.toBe(results[0]?.operation.key);
    expect(results.map((result): unknown => result.data)).toEqual([searchData('naruto')]);
    expect(site.operations.filter((operation) => nameOf(operation) === 'search')).toHaveLength(1);
    subscription.unsubscribe();
  });

  it('reaches the extension as a document event with a JSON detail, once the swap has put its client in place', async () => {
    const pageWindow = new Window({ url: 'https://senkuro.me/' });
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    const site = createSiteClient(() => ({ data: searchData() }));
    const ref = { __v_isRef: true, value: site.client as unknown };
    const typed = pageWindow as unknown as Parameters<typeof installClientSwap>[0];
    installClientSwap(typed, () => ({ exchangesFor: () => [searchExchange(createSearchPublisher(typed))] }));
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = { _context: { provides: { $urql: ref } } };
    const heard: unknown[] = [];
    pageWindow.document.addEventListener(searchSignal.name, (event) => heard.push(JSON.parse((event as unknown as CustomEvent<string>).detail)));
    await (ref.value as Client).query(searchDocument(), TERMS).toPromise();
    expect(heard).toEqual([
      { phase: 'start', ...TERMS },
      { phase: 'done', ...TERMS, settled: true, firstSlug: null },
    ]);
    await pageWindow.happyDOM.close();
  });
});
