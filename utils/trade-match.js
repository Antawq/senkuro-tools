export const sameCard = (a, b) => a?.slug === b?.slug && a?.quantity === b?.quantity && a?.shard === b?.shard;

export const totalOf = (side) => side.cards.length + side.hidden;

export const shows = (list, side) => list.length === totalOf(side) && side.cards.every((card, index) => sameCard(card, list[index]));

const single = (hits) => {
  const contents = new Set(hits.map((hit) => JSON.stringify([hit.offer, hit.request])));
  return hits.length > 0 && contents.size === 1 ? hits[0] : null;
};

export const matchTrade = (trades, [sourceName, destinationName], [offerSide, requestSide]) =>
  single(
    trades.filter(
      (trade) =>
        trade.source.name === sourceName &&
        (destinationName === null || trade.destination.name === destinationName) &&
        shows(trade.offer, offerSide) &&
        shows(trade.request, requestSide)
    )
  );

export const matchTradeByCounts = (trades, sourceName, offerCount, requestCount) =>
  single(trades.filter((trade) => trade.source.name === sourceName && trade.offer.length === offerCount && trade.request.length === requestCount));

export const matchOffer = (offers, authorName, top, middle) =>
  single(
    offers.filter(
      (offer) =>
        offer.author.name === authorName &&
        ((shows(offer.offer, top) && shows(offer.request, middle)) || (shows(offer.request, top) && shows(offer.offer, middle)))
    )
  );
