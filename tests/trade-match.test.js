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

describe('matching a stack drawn copy by copy', () => {
  const stacked = {
    kind: 'offer',
    id: 'o2',
    author: { id: 'u', name: 'Токунбек' },
    viewerDidAuthor: false,
    offer: [card('a'), card('b')],
    request: [card('x', 2)],
  };

  it('matches a stack of two that the card draws as two previews', () => {
    expect(matchOffer([stacked], 'Токунбек', side([card('a')], 1), side([card('x'), card('x')]))).toBe(stacked);
  });

  it('matches a stack whose extra copy is counted in the +N pill', () => {
    const offer = { ...stacked, offer: [card('a', 2)], request: [card('x')] };
    expect(matchOffer([offer], 'Токунбек', side([card('a')], 1), side([card('x')]))).toBe(offer);
  });

  it('matches a stack in the middle of a longer list', () => {
    const offer = { ...stacked, request: [card('x'), card('y', 3), card('z')] };
    expect(matchOffer([offer], 'Токунбек', side([card('a')], 1), side([card('x'), card('y'), card('y'), card('y'), card('z')]))).toBe(offer);
  });

  it('still matches the way it is drawn with one preview and a count', () => {
    expect(matchOffer([stacked], 'Токунбек', side([card('a')], 1), side([card('x', 2)]))).toBe(stacked);
  });

  it('does not match another number of copies', () => {
    expect(matchOffer([stacked], 'Токунбек', side([card('a')], 1), side([card('x'), card('x'), card('x')]))).toBeNull();
    expect(matchOffer([stacked], 'Токунбек', side([card('a')], 1), side([card('x')]))).toBeNull();
  });

  it('does not match other cards or another order', () => {
    expect(matchOffer([stacked], 'Токунбек', side([card('a')], 1), side([card('x'), card('y')]))).toBeNull();
    expect(matchOffer([stacked], 'Токунбек', side([card('b')], 1), side([card('x'), card('x')]))).toBeNull();
  });

  it('does not match previews whose card has not been drawn yet', () => {
    const blank = { slug: null, quantity: 1, shard: false };
    const offer = { ...stacked, offer: [{ ...blank }, { ...blank }], request: [{ ...blank, quantity: 2 }] };
    expect(matchOffer([offer], 'Токунбек', side([blank], 1), side([blank, blank]))).toBeNull();
  });

  it('keeps shards apart from whole cards', () => {
    const offer = { ...stacked, request: [{ slug: 'x', quantity: 2, shard: true }] };
    expect(matchOffer([offer], 'Токунбек', side([card('a')], 1), side([card('x'), card('x')]))).toBeNull();
    expect(
      matchOffer(
        [offer],
        'Токунбек',
        side([card('a')], 1),
        side([
          { slug: 'x', quantity: 1, shard: true },
          { slug: 'x', quantity: 1, shard: true },
        ])
      )
    ).toBe(offer);
  });

  it('matches a trade whose stacks are drawn copy by copy', () => {
    const hit = trade('t9', [card('a', 2), card('b')], [card('x', 2)]);
    expect(matchTrade([hit], ['Он', 'Я'], [side([card('a'), card('a'), card('b')]), side([card('x'), card('x')])])).toBe(hit);
  });
});
