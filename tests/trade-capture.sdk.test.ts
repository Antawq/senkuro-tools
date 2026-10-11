import type { CardOffersData, CardTradesData } from '@antawq/senkuro';
import { describe, expect, it } from 'vitest';

import { captureTrades } from '../utils/trade-capture';

type TradeNode = CardTradesData['cardTrades']['edges'][number]['node'];
type OfferNode = CardOffersData['cardOffers']['edges'][number]['node'];
type OfferPreview = Pick<OfferNode['offer'][number], 'quantity' | 'shard'> & { card: Pick<OfferNode['offer'][number]['card'], 'slug'> };

const tradePreview = (slug: string, rank: string, quantity = 1, shard = false): TradeNode['offer'][number] => ({
  modifier: 0,
  quantity,
  shard,
  card: { id: `card:${slug}`, slug, rank, titles: [{ lang: 'RU', content: slug }] },
});

const offerPreview = (slug: string, quantity = 1, shard = false): OfferPreview => ({ quantity, shard, card: { slug } });

const trade = (id: string, offer: TradeNode['offer'], request: TradeNode['request']): TradeNode => ({
  id,
  status: 'PENDING',
  createdAt: '2026-10-10T06:10:00.945673',
  viewerCanAccept: true,
  viewerCanDecline: true,
  source: { id: 'user-1', slug: 'first', name: 'First | WL' },
  destination: { id: 'user-2', slug: 'second', name: 'Second | WS' },
  offer,
  request,
});

const asTrade = (node: TradeNode) => ({ __typename: 'CardTrade', ...node });

describe('trade capture on payloads shaped by the SDK', () => {
  it('reads a trade selected by the CardTrades document', () => {
    const node = trade('trade-1', [tradePreview('a-card-a', 'A', 2), tradePreview('s-card-s', 'S', 3, true)], [tradePreview('d-card-d', 'D')]);
    const { viewerId, items } = captureTrades({ data: { cardTrades: { edges: [{ node: asTrade(node) }] } } });
    expect(viewerId).toBeNull();
    expect(items).toEqual([
      {
        kind: 'trade',
        id: 'trade-1',
        source: { id: 'user-1', name: 'First | WL' },
        destination: { id: 'user-2', name: 'Second | WS' },
        offer: [
          { slug: 'a-card-a', quantity: 2, shard: false },
          { slug: 's-card-s', quantity: 3, shard: true },
        ],
        request: [{ slug: 'd-card-d', quantity: 1, shard: false }],
      },
    ]);
  });

  it('reads every trade of a page of the connection', () => {
    const edges = [trade('trade-1', [tradePreview('a-card-a', 'A')], []), trade('trade-2', [], [tradePreview('f-card-f', 'F', 4)])].map((node) => ({
      node: asTrade(node),
    }));
    const { items } = captureTrades({ data: { cardTrades: { pageInfo: { hasNextPage: false, endCursor: null }, edges } } });
    expect(items.map((item) => item.id)).toEqual(['trade-1', 'trade-2']);
    expect(items[1]?.request).toEqual([{ slug: 'f-card-f', quantity: 4, shard: false }]);
  });

  it('reads an offer selected by the CardOffers document', () => {
    const user: Pick<OfferNode['user'], 'id' | 'name'> = { id: 'user-3', name: 'Smile' };
    const node = {
      __typename: 'CardOffer',
      id: 'offer-1',
      user,
      viewerDidAuthor: false,
      offer: [offerPreview('f-card-f')],
      request: [offerPreview('s-card-s', 1, true)],
    };
    const { items } = captureTrades({ data: { cardOffers: { edges: [{ node }] } } });
    expect(items).toEqual([
      {
        kind: 'offer',
        id: 'offer-1',
        author: { id: 'user-3', name: 'Smile' },
        viewerDidAuthor: false,
        offer: [{ slug: 'f-card-f', quantity: 1, shard: false }],
        request: [{ slug: 's-card-s', quantity: 1, shard: true }],
      },
    ]);
  });
});
