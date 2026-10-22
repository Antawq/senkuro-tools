import { parseApiTime } from '../shared/time';
import type { CardRef } from '../shared/trade-value';
import type { Person, Trade } from './trade-capture';

const ACCEPTED = 'ACCEPTED';
const REJECTED = 'REJECTED';

export interface Departure {
  card: CardRef;
  from: Person;
  to: Person;
  at: string | null;
}

interface Hand {
  owner: Person;
  cards: CardRef[];
  to: Person;
}

const handsOf = (trade: Trade): Hand[] => [
  { owner: trade.source, cards: trade.offer, to: trade.destination },
  { owner: trade.destination, cards: trade.request, to: trade.source },
];

const sameCard = (a: CardRef, b: CardRef): boolean => a.slug !== null && a.slug === b.slug && a.shard === b.shard;

const timeOf = (value: string | null): number => parseApiTime(value)?.getTime() ?? 0;

const departuresIn = (rejected: Trade, accepted: Trade): Departure[] =>
  handsOf(rejected).flatMap(({ owner, cards, to }) =>
    handsOf(accepted)
      .filter((hand) => owner.id !== null && hand.owner.id === owner.id && hand.to.id !== to.id)
      .flatMap((hand) =>
        cards
          .filter((card) => hand.cards.some((given) => sameCard(card, given)))
          .map((card) => ({ card, from: hand.owner, to: hand.to, at: accepted.createdAt }))
      )
  );

export function departureOf(rejected: Trade, trades: Trade[]): Departure | null {
  if (rejected.status !== REJECTED) return null;
  const found = trades
    .filter((trade) => trade.status === ACCEPTED)
    .flatMap((trade) => departuresIn(rejected, trade))
    .sort((a, b) => timeOf(a.at) - timeOf(b.at));
  const sent = timeOf(rejected.createdAt);
  return found.find((departure) => timeOf(departure.at) >= sent) ?? found.at(-1) ?? null;
}
