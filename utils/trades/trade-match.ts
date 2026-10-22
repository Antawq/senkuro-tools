import type { Offer, Trade } from './trade-capture';
import type { CardRef, Side } from '../shared/trade-value';

const sameCard = (a: CardRef | undefined, b: CardRef | undefined): boolean => a?.slug === b?.slug && a?.quantity === b?.quantity && a?.shard === b?.shard;

export const totalOf = (side: Side): number => side.cards.length + side.hidden;

const copiesOf = (cards: CardRef[]): string[] | null =>
  cards.some(({ slug }) => slug === null)
    ? null
    : cards.flatMap(({ slug, quantity, shard }) => Array.from({ length: Math.max(1, Math.floor(quantity) || 1) }, () => `${slug}:${shard}`));

const showsEntries = (list: CardRef[], side: Side): boolean => list.length === totalOf(side) && side.cards.every((card, index) => sameCard(card, list[index]));

const showsCopies = (list: CardRef[], side: Side): boolean => {
  const listed = copiesOf(list);
  const drawn = copiesOf(side.cards);
  return listed !== null && drawn !== null && listed.length === drawn.length + side.hidden && drawn.every((copy, index) => copy === listed[index]);
};

export const shows = (list: CardRef[], side: Side): boolean => showsEntries(list, side) || showsCopies(list, side);

const single = <T extends Trade | Offer>(hits: T[]): T | null => {
  const contents = new Set(hits.map((hit) => JSON.stringify([hit.offer, hit.request])));
  return hits.length > 0 && contents.size === 1 ? (hits[0] ?? null) : null;
};

const singleTrade = (hits: Trade[]): Trade | null => {
  const trade = single(hits);
  if (!trade) return null;
  const agreed = <K extends 'createdAt' | 'status'>(key: K): Trade[K] | null => (hits.every((hit) => hit[key] === trade[key]) ? trade[key] : null);
  const [createdAt, status] = [agreed('createdAt'), agreed('status')];
  return createdAt === trade.createdAt && status === trade.status ? trade : { ...trade, createdAt, status };
};

export const matchTrade = (trades: Trade[], [sourceName, destinationName]: [string, string | null], [offerSide, requestSide]: [Side, Side]): Trade | null =>
  singleTrade(
    trades.filter(
      (trade) =>
        trade.source.name === sourceName &&
        (destinationName === null || trade.destination.name === destinationName) &&
        shows(trade.offer, offerSide) &&
        shows(trade.request, requestSide)
    )
  );

export const matchTradeByCounts = (trades: Trade[], sourceName: string, offerCount: number, requestCount: number): Trade | null =>
  singleTrade(trades.filter((trade) => trade.source.name === sourceName && trade.offer.length === offerCount && trade.request.length === requestCount));

export const matchOffer = (offers: Offer[], authorName: string, top: Side, middle: Side): Offer | null =>
  single(
    offers.filter(
      (offer) =>
        offer.author.name === authorName &&
        ((shows(offer.offer, top) && shows(offer.request, middle)) || (shows(offer.request, top) && shows(offer.offer, middle)))
    )
  );
