import { effectivePrice } from './cards.js';

const FORGE_LADDER = ['F', 'D', 'C', 'B', 'A', 'S'];
const CARDS_PER_FORGE = 3;
const RANK_ORDER = ['R', 'S', 'A', 'B', 'C', 'D', 'F'];

const rateInF = (rank) => {
  const step = FORGE_LADDER.indexOf(rank);
  return step === -1 ? null : CARDS_PER_FORGE ** step;
};

const rankPosition = (rank) => {
  const position = RANK_ORDER.indexOf(rank);
  return position === -1 ? RANK_ORDER.length : position;
};

const addTo = (map, rank, amount) => map.set(rank, (map.get(rank) ?? 0) + amount);

const priceOf = (entry) => (typeof entry?.price === 'number' && Number.isFinite(entry.price) ? entry.price : null);

export function valueSide({ cards, hidden }, db, commission) {
  const side = {
    f: 0,
    bank: new Map(),
    count: new Map(),
    unknown: hidden,
    beyondF: false,
    shards: new Map(),
    shardF: 0,
    shardUnknown: 0,
    shardBeyondF: false,
  };

  for (const { slug, quantity, shard } of cards) {
    const entry = slug ? db[slug] : undefined;
    const price = priceOf(entry);
    const rate = rateInF(entry?.rank);
    if (shard) {
      if (price === null) {
        side.shardUnknown += quantity;
        continue;
      }
      addTo(side.shards, entry.rank, quantity);
      if (rate === null) side.shardBeyondF = true;
      else side.shardF += effectivePrice(price, commission) * quantity * rate;
      continue;
    }
    if (price === null) {
      side.unknown += quantity;
      continue;
    }
    const value = effectivePrice(price, commission) * quantity;
    addTo(side.bank, entry.rank, value);
    addTo(side.count, entry.rank, quantity);
    if (rate === null) side.beyondF = true;
    else side.f += value * rate;
  }

  const hasShards = side.shards.size > 0 || side.shardUnknown > 0;
  return {
    ...side,
    hasShards,
    complete: side.unknown === 0 && !side.beyondF,
    shardsComplete: side.shardUnknown === 0 && !side.shardBeyondF,
  };
}

export const formatAmount = (amount) => String(+amount.toFixed(2));

export const formatByRank = (map) => [...map.keys()].sort((a, b) => rankPosition(a) - rankPosition(b)).map((rank) => `${formatAmount(map.get(rank))}${rank}`);

function compare(given, got, complete, prefix) {
  const diff = got - given;
  const shown = formatAmount(Math.abs(diff));
  const percent = given > 0 ? ` (${diff > 0 ? '+' : '-'}${Math.round(Math.abs(diff / given) * 100)}%)` : '';
  if (shown === '0') return { kind: 'even', text: `${prefix}Равноценно`, complete };
  if (diff > 0) return { kind: 'gain', text: `${prefix}Выгода +${shown}F${percent}`, complete };
  return { kind: 'loss', text: `${prefix}Потеря -${shown}F${percent}`, complete };
}

export const compareSides = (give, get) => compare(give.f, get.f, give.complete && get.complete, '');

export const compareShards = (give, get) =>
  give.hasShards || get.hasShards ? compare(give.shardF, get.shardF, give.shardsComplete && get.shardsComplete, 'Осколки: ') : null;
