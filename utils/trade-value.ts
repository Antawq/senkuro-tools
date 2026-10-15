import { PERCENT, PRICE_DECIMALS, effectivePrice } from './cards';
import type { Database } from './database';
import type { ValueBasis } from './settings';

export interface CardRef {
  slug: string | null;
  quantity: number;
  shard: boolean;
}

export interface Side {
  cards: CardRef[];
  hidden: number;
}

export interface RValue {
  value: number;
  count: number;
  shards: number;
  complete: boolean;
}

export interface SideValue {
  f: number;
  bank: Map<string, number>;
  count: Map<string, number>;
  unknown: number;
  beyondF: boolean;
  shards: Map<string, number>;
  shardBank: Map<string, number>;
  shardUnknown: number;
  hasShards: boolean;
  r: RValue;
  complete: boolean;
}

export interface Verdict {
  kind: 'even' | 'gain' | 'loss';
  text: string;
  certain: boolean;
}

interface Scale {
  prefix: string;
  unit: string;
}

export interface Valuation {
  commission: boolean;
  valueBySplit: boolean;
  valueBasis: ValueBasis;
}

export const R_RANK = 'R';
export const SHARD_MARK = 'o';
export const UNKNOWN_MARK = 'X';
export const F_UNIT = 'F';

const FORGE_LADDER = [F_UNIT, 'D', 'C', 'B', 'A', 'S'];
const RANK_ORDER = [R_RANK, ...[...FORGE_LADDER].reverse()];

export const CRAFT_PER_RANK = 3;
export const SPLIT_PER_RANK = 2;

const SHARDS_REQUIRED: Record<string, number> = { R: 12, S: 10, A: 8, B: 6, C: 4, D: 2 };

const rateInF = (rank: string | undefined, perRank: number): number | null => {
  const step = rank ? FORGE_LADDER.indexOf(rank) : -1;
  return step === -1 ? null : perRank ** step;
};

const rankPosition = (rank: string): number => {
  const position = RANK_ORDER.indexOf(rank);
  return position === -1 ? RANK_ORDER.length : position;
};

const addTo = (map: Map<string, number>, rank: string, amount: number) => map.set(rank, (map.get(rank) ?? 0) + amount);

const priceOf = (entry: { price?: unknown } | undefined): number | null =>
  typeof entry?.price === 'number' && Number.isFinite(entry.price) ? entry.price : null;

export function valueSide({ cards, hidden }: Side, db: Database, commission: boolean, perRank = CRAFT_PER_RANK, basis: ValueBasis = 'bank'): SideValue {
  const side = {
    f: 0,
    bank: new Map<string, number>(),
    count: new Map<string, number>(),
    unknown: hidden,
    beyondF: false,
    shards: new Map<string, number>(),
    shardBank: new Map<string, number>(),
    shardUnknown: 0,
    r: { value: 0, count: 0, shards: 0 },
  };

  for (const { slug, quantity, shard } of cards) {
    const entry = slug ? db[slug] : undefined;
    const price = priceOf(entry);
    const rate = rateInF(entry?.rank, perRank);
    if (shard) {
      if (price === null || !entry) {
        side.shardUnknown += quantity;
        continue;
      }
      const required = SHARDS_REQUIRED[entry.rank] || 1;
      const bank = effectivePrice(price, commission) * quantity;
      addTo(side.shards, entry.rank, quantity);
      addTo(side.shardBank, entry.rank, bank / required);
      if (entry.rank === R_RANK) side.r.shards += quantity;
      else if (rate === null) side.beyondF = true;
      else side.f += ((basis === 'cards' ? quantity : bank) * rate) / required;
      continue;
    }
    if (price === null || !entry) {
      side.unknown += quantity;
      continue;
    }
    const value = effectivePrice(price, commission) * quantity;
    addTo(side.bank, entry.rank, value);
    addTo(side.count, entry.rank, quantity);
    const weight = basis === 'cards' ? quantity : value;
    if (entry.rank === R_RANK) {
      side.r.value += weight;
      side.r.count += quantity;
    } else if (rate === null) side.beyondF = true;
    else side.f += weight * rate;
  }

  const hasShards = side.shards.size > 0 || side.shardUnknown > 0;
  const settled = side.unknown === 0 && side.shardUnknown === 0;
  return {
    ...side,
    hasShards,
    r: { ...side.r, complete: settled && side.r.shards === 0 },
    complete: settled && !side.beyondF,
  };
}

export const valueWith = (side: Side, db: Database, { commission, valueBySplit, valueBasis }: Valuation): SideValue =>
  valueSide(side, db, commission, valueBySplit ? SPLIT_PER_RANK : CRAFT_PER_RANK, valueBasis);

export const hasR = ({ r }: Pick<SideValue, 'r'>): boolean => r.count > 0 || r.shards > 0;

export const formatAmount = (amount: number): string => String(+amount.toFixed(PRICE_DECIMALS));

export const formatByRank = (map: Map<string, number>): string[] =>
  [...map.keys()].sort((a, b) => rankPosition(a) - rankPosition(b)).map((rank) => `${formatAmount(map.get(rank) ?? 0)}${rank}`);

export const formatShardsByRank = (map: Map<string, number>): string[] =>
  [...map.keys()].sort((a, b) => rankPosition(a) - rankPosition(b)).map((rank) => `${formatAmount(map.get(rank) ?? 0)}${SHARD_MARK}${rank}`);

const F_SCALE: Scale = { prefix: '', unit: F_UNIT };
const R_SCALE: Scale = { prefix: 'R: ', unit: R_RANK };

const priced = (known: number, settled: boolean): boolean => known > 0 || settled;

function compare(given: number, got: number, certain: boolean, { prefix, unit }: Scale): Verdict {
  const diff = got - given;
  const shown = formatAmount(Math.abs(diff));
  const percent = given > 0 ? ` (${diff > 0 ? '+' : '-'}${Math.round(Math.abs(diff / given) * PERCENT)}%)` : '';
  if (shown === '0') return { kind: 'even', text: `${prefix}Равноценно`, certain };
  if (diff > 0) return { kind: 'gain', text: `${prefix}Выгода +${shown}${unit}${percent}`, certain };
  return { kind: 'loss', text: `${prefix}Потеря -${shown}${unit}${percent}`, certain };
}

export const compareSides = (give: Pick<SideValue, 'f' | 'complete'>, get: Pick<SideValue, 'f' | 'complete'>): Verdict =>
  compare(give.f, get.f, priced(give.f, give.complete) && priced(get.f, get.complete), F_SCALE);

export const compareR = (give: Pick<SideValue, 'r'>, get: Pick<SideValue, 'r'>): Verdict | null =>
  hasR(give) || hasR(get) ? compare(give.r.value, get.r.value, priced(give.r.value, give.r.complete) && priced(get.r.value, get.r.complete), R_SCALE) : null;
