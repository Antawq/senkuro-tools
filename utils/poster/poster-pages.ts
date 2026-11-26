import { POSTER_CARDS_PER_PAGE } from './poster-layout';

const isShardCard = (card: unknown): boolean => typeof card === 'object' && card !== null && 'shard' in card && Boolean((card as { shard?: boolean }).shard);

function balancePages<T>(cards: readonly T[]): T[][] {
  if (cards.length === 0) return [];
  const pageCount = Math.ceil(cards.length / POSTER_CARDS_PER_PAGE);
  const baseSize = Math.floor(cards.length / pageCount);
  const largerPageCount = cards.length % pageCount;
  const startOf = (index: number): number => index * baseSize + Math.min(index, largerPageCount);
  return Array.from({ length: pageCount }, (_, index) => cards.slice(startOf(index), startOf(index + 1)));
}

export function splitIntoPages<T>(cards: readonly T[]): T[][] {
  if (cards.length <= POSTER_CARDS_PER_PAGE) return balancePages(cards);
  const wholeCards = cards.filter((card) => !isShardCard(card));
  const shardCards = cards.filter(isShardCard);
  if (wholeCards.length > 0 && shardCards.length > 0) return [...balancePages(wholeCards), ...balancePages(shardCards)];
  return balancePages(cards);
}
