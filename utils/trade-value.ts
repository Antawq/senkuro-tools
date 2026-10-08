import { effectivePrice } from './cards';
import type { Database } from './database';

export interface CardRef {
  slug: string | null;
  quantity: number;
  shard: boolean;
}

export interface Side {
  cards: CardRef[];
  hidden: number;
}

export interface SideValue {
  f: number;
  bank: Map<string, number>;
  count: Map<string, number>;
  unknown: number;
  beyondF: boolean;
  shards: Map<string, number>;
  shardF: number;
  shardUnknown: number;
  shardBeyondF: boolean;
  hasShards: boolean;
  complete: boolean;
  shardsComplete: boolean;
}

export interface Verdict {
  kind: 'even' | 'gain' | 'loss';
  text: string;
  complete: boolean;
}

const FORGE_LADDER = ['F', 'D', 'C', 'B', 'A', 'S'];
const CARDS_PER_FORGE = 3;
const RANK_ORDER = ['R', 'S', 'A', 'B', 'C', 'D', 'F'];

const rateInF = (rank: string | undefined): number | null => {
  const step = rank ? FORGE_LADDER.indexOf(rank) : -1;
  return step === -1 ? null : CARDS_PER_FORGE ** step;
};

const rankPosition = (rank: string): number => {
  const position = RANK_ORDER.indexOf(rank);
  return position === -1 ? RANK_ORDER.length : position;
};

const addTo = (map: Map<string, number>, rank: string, amount: number) => map.set(rank, (map.get(rank) ?? 0) + amount);

const priceOf = (entry: { price?: unknown } | undefined): number | null =>
  typeof entry?.price === 'number' && Number.isFinite(entry.price) ? entry.price : null;

export function valueSide({ cards, hidden }: Side, db: Database, commission: boolean): SideValue {
  const side = {
    f: 0,
    bank: new Map<string, number>(),
    count: new Map<string, number>(),
    unknown: hidden,
    beyondF: false,
    shards: new Map<string, number>(),
    shardF: 0,
    shardUnknown: 0,
    shardBeyondF: false,
  };

  for (const { slug, quantity, shard } of cards) {
    const entry = slug ? db[slug] : undefined;
    const price = priceOf(entry);
    const rate = rateInF(entry?.rank);
    if (shard) {
      if (price === null || !entry) {
        side.shardUnknown += quantity;
        continue;
      }
      addTo(side.shards, entry.rank, quantity);
      if (rate === null) side.shardBeyondF = true;
      else side.shardF += effectivePrice(price, commission) * quantity * rate;
      continue;
    }
    if (price === null || !entry) {
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

export const formatAmount = (amount: number): string => String(+amount.toFixed(2));

export const formatByRank = (map: Map<string, number>): string[] =>
  [...map.keys()].sort((a, b) => rankPosition(a) - rankPosition(b)).map((rank) => `${formatAmount(map.get(rank) ?? 0)}${rank}`);

function compare(given: number, got: number, complete: boolean, prefix: string): Verdict {
  const diff = got - given;
  const shown = formatAmount(Math.abs(diff));
  const percent = given > 0 ? ` (${diff > 0 ? '+' : '-'}${Math.round(Math.abs(diff / given) * 100)}%)` : '';
  if (shown === '0') return { kind: 'even', text: `${prefix}Равноценно`, complete };
  if (diff > 0) return { kind: 'gain', text: `${prefix}Выгода +${shown}F${percent}`, complete };
  return { kind: 'loss', text: `${prefix}Потеря -${shown}F${percent}`, complete };
}

export const compareSides = (give: Pick<SideValue, 'f' | 'complete'>, get: Pick<SideValue, 'f' | 'complete'>): Verdict =>
  compare(give.f, get.f, give.complete && get.complete, '');

type ShardPart = Pick<SideValue, 'hasShards' | 'shardF' | 'shardsComplete'>;

export const compareShards = (give: ShardPart, get: ShardPart): Verdict | null =>
  give.hasShards || get.hasShards ? compare(give.shardF, get.shardF, give.shardsComplete && get.shardsComplete, 'Осколки: ') : null;
