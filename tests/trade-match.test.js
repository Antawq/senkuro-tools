import { describe, expect, it } from 'vitest';

import { matchOffer, matchTrade, matchTradeByCounts } from '../utils/trade-match';

const card = (slug, quantity = 1) => ({ slug, quantity, shard: false });
const trade = (id, offer, request, source = 'Он', destination = 'Я') => ({
  kind: 'trade',
  id,
  source: { id: 's', name: source },
  destination: { id: 'd', name: destination },
  offer,
  request,
});
const side = (cards, hidden = 0) => ({ cards, hidden });

const four = [card('a', 2), card('b'), card('c', 3), card('d', 3)];

describe('matchTrade', () => {
  it('finds the trade from the drawn cards and the counters', () => {
    const hit = trade('t1', four, [card('x')]);
    expect(matchTrade([trade('t0', four.slice(0, 3), [card('x')]), hit], ['Он', 'Я'], [side(four.slice(0, 3), 1), side([card('x')])])).toBe(hit);
  });

  it('gives up when two different trades look the same on screen', () => {
    const other = trade('t2', [...four.slice(0, 3), card('e')], [card('x')]);
    expect(matchTrade([trade('t1', four, [card('x')]), other], ['Он', 'Я'], [side(four.slice(0, 3), 1), side([card('x')])])).toBeNull();
  });

  it('takes either of two identical trades', () => {
    expect(matchTrade([trade('t1', four, []), trade('t2', four, [])], ['Он', null], [side(four.slice(0, 3), 1), side([])])?.id).toBe('t1');
  });

  it('checks the names and the quantities', () => {
    const trades = [trade('t1', four, [])];
    expect(matchTrade(trades, ['Другой', null], [side(four.slice(0, 3), 1), side([])])).toBeNull();
    expect(matchTrade(trades, ['Он', null], [side([card('a', 1), ...four.slice(1, 3)], 1), side([])])).toBeNull();
  });
});

describe('matchTradeByCounts', () => {
  it('finds a single trade of the sender with these counts', () => {
    expect(matchTradeByCounts([trade('t1', four, [card('x')]), trade('t2', [card('a')], [card('x')])], 'Он', 4, 1)?.id).toBe('t1');
  });
});

describe('matchOffer', () => {
  const offer = { kind: 'offer', id: 'o1', author: { id: 'u', name: 'Smile' }, viewerDidAuthor: false, offer: [card('a')], request: [card('b'), card('c')] };

  it('matches whichever way the card shows the two lists', () => {
    expect(matchOffer([offer], 'Smile', side([card('b')], 1), side([card('a')]))).toBe(offer);
    expect(matchOffer([offer], 'Smile', side([card('a')]), side([card('b'), card('c')]))).toBe(offer);
  });
});
