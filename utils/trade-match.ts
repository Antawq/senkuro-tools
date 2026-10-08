import type { Offer, Trade } from './trade-capture';
import type { CardRef, Side } from './trade-value';

export const sameCard = (a: CardRef | undefined, b: CardRef | undefined): boolean =>
  a?.slug === b?.slug && a?.quantity === b?.quantity && a?.shard === b?.shard;

export const totalOf = (side: Side): number => side.cards.length + side.hidden;

export const shows = (list: CardRef[], side: Side): boolean => list.length === totalOf(side) && side.cards.every((card, index) => sameCard(card, list[index]));

const single = <T extends Trade | Offer>(hits: T[]): T | null => {
  const contents = new Set(hits.map((hit) => JSON.stringify([hit.offer, hit.request])));
  return hits.length > 0 && contents.size === 1 ? (hits[0] ?? null) : null;
};

export const matchTrade = (trades: Trade[], [sourceName, destinationName]: [string, string | null], [offerSide, requestSide]: [Side, Side]): Trade | null =>
  single(
    trades.filter(
      (trade) =>
        trade.source.name === sourceName &&
        (destinationName === null || trade.destination.name === destinationName) &&
        shows(trade.offer, offerSide) &&
        shows(trade.request, requestSide)
    )
  );

export const matchTradeByCounts = (trades: Trade[], sourceName: string, offerCount: number, requestCount: number): Trade | null =>
  single(trades.filter((trade) => trade.source.name === sourceName && trade.offer.length === offerCount && trade.request.length === requestCount));

export const matchOffer = (offers: Offer[], authorName: string, top: Side, middle: Side): Offer | null =>
  single(
    offers.filter(
      (offer) =>
        offer.author.name === authorName &&
        ((shows(offer.offer, top) && shows(offer.request, middle)) || (shows(offer.request, top) && shows(offer.offer, middle)))
    )
  );
