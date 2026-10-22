import { describe, expect, it } from 'vitest';

import type { Person, Trade } from '../utils/trades/trade-capture';
import { departureOf } from '../utils/trades/trade-departure';
import type { CardRef } from '../utils/trades/trade-value';

const card = (slug: string, shard = false): CardRef => ({ slug, quantity: 1, shard });
const nafar: Person = { id: 'n', name: 'Nafarmillion' };
const brunya: Person = { id: 'b', name: 'Brunya' };
const laminat: Person = { id: 'l', name: 'Laminat' };
const kira: Person = { id: 'k', name: 'Kira' };
const trade = (id: string, status: string, createdAt: string, source: Person, destination: Person, offer: CardRef[], request: CardRef[]): Trade => ({
  kind: 'trade',
  id,
  status,
  createdAt,
  source,
  destination,
  offer,
  request,
});

const rejected = trade('r', 'REJECTED', '2026-10-15T07:09:00', nafar, brunya, [card('undina'), card('siren')], [card('khvaran')]);

describe('departureOf', () => {
  it('finds the accepted trade in which the owner gave away a card of the rejected one', () => {
    const accepted = trade('a', 'ACCEPTED', '2026-10-15T08:31:00.123456', laminat, nafar, [card('kail')], [card('siren')]);
    expect(departureOf(rejected, [rejected, accepted])).toEqual({ card: card('siren'), from: nafar, to: laminat, at: '2026-10-15T08:31:00.123456' });
  });

  it('looks at the cards the other side was asked for too', () => {
    const accepted = trade('a', 'ACCEPTED', '2026-10-15T08:00:00', brunya, laminat, [card('khvaran')], []);
    expect(departureOf(rejected, [accepted])).toMatchObject({ card: card('khvaran'), from: brunya, to: laminat });
  });

  it('takes the first departure after the rejected trade was sent, or the latest one before it', () => {
    const before = trade('a1', 'ACCEPTED', '2026-10-15T06:00:00', nafar, laminat, [card('undina')], []);
    const later = trade('a2', 'ACCEPTED', '2026-10-15T09:00:00', nafar, laminat, [card('siren')], []);
    const first = trade('a3', 'ACCEPTED', '2026-10-15T08:00:00', nafar, kira, [card('undina')], []);
    expect(departureOf(rejected, [later, before, first])?.at).toBe('2026-10-15T08:00:00');
    expect(departureOf(rejected, [before])?.at).toBe('2026-10-15T06:00:00');
  });

  it('ignores a card the owner received, a different owner, a shard of the same card and trades that were not accepted', () => {
    const received = trade('a1', 'ACCEPTED', '2026-10-15T08:00:00', laminat, nafar, [card('siren')], []);
    const stranger = trade('a2', 'ACCEPTED', '2026-10-15T08:00:00', laminat, brunya, [card('siren')], []);
    const shard = trade('a3', 'ACCEPTED', '2026-10-15T08:00:00', nafar, laminat, [card('siren', true)], []);
    const pending = trade('a4', 'PENDING', '2026-10-15T08:00:00', nafar, laminat, [card('siren')], []);
    expect(departureOf(rejected, [received, stranger, shard, pending])).toBeNull();
  });

  it('marks only the trade whose card went to a third user, as the sample from the history page shows', () => {
    const siren = card('siren');
    const accepted = trade('t1331', 'ACCEPTED', '2026-10-15T08:31:00', laminat, nafar, [card('kail')], [siren]);
    const sameCouple = trade('t1217', 'REJECTED', '2026-10-15T07:17:00', laminat, nafar, [card('yorumi')], [card('rotorua'), siren]);
    const withBrunya = trade('t1209', 'REJECTED', '2026-10-15T07:09:00', nafar, brunya, [card('undina'), siren], [card('khvaran')]);
    const page = [accepted, sameCouple, withBrunya];
    expect(departureOf(sameCouple, page)).toBeNull();
    expect(departureOf(withBrunya, page)).toMatchObject({ card: siren, from: nafar, to: laminat });
  });

  it('says nothing about a trade that was not rejected', () => {
    const accepted = trade('a', 'ACCEPTED', '2026-10-15T08:31:00', nafar, laminat, [card('siren')], []);
    expect(departureOf({ ...rejected, status: 'PENDING' }, [accepted])).toBeNull();
    expect(departureOf({ ...rejected, status: null }, [accepted])).toBeNull();
  });
});
