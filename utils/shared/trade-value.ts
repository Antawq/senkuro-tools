import { PERCENT, PRICE_DECIMALS, effectivePrice } from './cards';
import type { CardEntry, Database } from './database';
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

export interface BranchValue {
  value: number;
  count: number;
  shards: number;
  complete: boolean;
}

export type RValue = BranchValue;
export type XValue = BranchValue;
export type EstimatedValue = BranchValue;

export interface SideValue {
  f: number;
  bank: Map<string, number>;
  count: Map<string, number>;
  unknown: number;
  beyondF: boolean;
  shards: Map<string, number>;
  shardBank: Map<string, number>;
  shardUnknown: number;
  r: RValue;
  x: XValue;
  estimated: EstimatedValue;
  complete: boolean;
  estimatedBank: Map<string, number>;
  estimatedShardBank: Map<string, number>;
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
  excludeShards: boolean;
}

export const R_RANK = 'R';
export const X_RANK = 'X';
export const SHARD_MARK = 'o';
export const UNKNOWN_MARK = '?';
export const UNKNOWN_LEGEND = `${UNKNOWN_MARK} - нет цены в базе`;
export const F_UNIT = 'F';

export const MIN_BANK_PRICE = 1.25;
export const VALID_RANKS = ['X', 'R', 'S', 'A', 'B', 'C', 'D', 'F'] as const;

export function extractRankFromSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const s = slug.toLowerCase().trim();
  if (s.endsWith('-r-plus') || s.endsWith('-r+')) return R_RANK;
  if (s.endsWith('-f-plus') || s.endsWith('-f+')) return F_UNIT;
  const parts = s.split('-');
  if (parts.length < 2) return null;
  const last = parts.at(-1)?.toUpperCase();
  if (last && (VALID_RANKS as readonly string[]).includes(last)) return last;
  if (parts.length >= 3) {
    const prev = parts.at(-2)?.toUpperCase();
    if (prev && (VALID_RANKS as readonly string[]).includes(prev)) return prev;
  }
  return null;
}

const FORGE_LADDER = [F_UNIT, 'D', 'C', 'B', 'A', 'S'];
const RANK_ORDER = [X_RANK, R_RANK, ...[...FORGE_LADDER].reverse()];

export const CRAFT_PER_RANK = 3;
export const SPLIT_PER_RANK = 2;

const SHARDS_REQUIRED: Record<string, number> = { S: 10, A: 8, B: 6, C: 4, D: 2 };

const rateInF = (rank: string | undefined, perRank: number): number | null => {
  const step = rank ? FORGE_LADDER.indexOf(rank) : -1;
  return step === -1 ? null : perRank ** step;
};

const rankPosition = (rank: string): number => {
  if (rank === UNKNOWN_MARK) return RANK_ORDER.length + 1;
  const position = RANK_ORDER.indexOf(rank);
  return position === -1 ? RANK_ORDER.length : position;
};

const addTo = (map: Map<string, number>, rank: string, amount: number) => map.set(rank, (map.get(rank) ?? 0) + amount);

interface Pricing {
  commission: boolean;
  perRank: number;
  basis: ValueBasis;
  excludeShards: boolean;
}

type Tally = Omit<SideValue, 'r' | 'x' | 'estimated' | 'complete'> & {
  r: Omit<RValue, 'complete'>;
  x: Omit<XValue, 'complete'>;
  estimated: Omit<EstimatedValue, 'complete'>;
};

const emptyTally = (hidden: number): Tally => ({
  f: 0,
  bank: new Map<string, number>(),
  count: new Map<string, number>(),
  unknown: hidden,
  beyondF: false,
  shards: new Map<string, number>(),
  shardBank: new Map<string, number>(),
  shardUnknown: 0,
  r: { value: 0, count: 0, shards: 0 },
  x: { value: 0, count: 0, shards: 0 },
  estimated: { value: 0, count: 0, shards: 0 },
  estimatedBank: new Map<string, number>(),
  estimatedShardBank: new Map<string, number>(),
});

function addEstimatedCards(tally: Tally, rank: string, quantity: number, { commission, perRank, basis }: Pricing): void {
  const value = effectivePrice(MIN_BANK_PRICE, commission) * quantity;
  const weight = basis === 'cards' ? quantity : value;
  addTo(tally.count, rank, quantity);
  addTo(tally.estimatedBank, rank, quantity);

  if (rank === R_RANK) {
    tally.r.value += weight;
    tally.r.count += quantity;
  } else if (rank === X_RANK) {
    tally.x.value += weight;
    tally.x.count += quantity;
  } else {
    const rate = rateInF(rank, perRank);
    if (rate !== null) {
      const fVal = weight * rate;
      addToF(tally, rank, weight, perRank);
      tally.estimated.value += fVal;
      tally.estimated.count += quantity;
    }
  }
}

function addEstimatedShards(tally: Tally, rank: string, quantity: number, { commission, perRank, basis, excludeShards }: Pricing): void {
  const perCard = SHARDS_REQUIRED[rank] || 1;
  const bank = effectivePrice(MIN_BANK_PRICE, commission) * quantity;
  addTo(tally.shards, rank, quantity);
  addTo(tally.estimatedShardBank, rank, quantity);
  if (excludeShards) return;

  if (rank === R_RANK) {
    tally.r.shards += quantity;
  } else if (rank === X_RANK) {
    tally.x.shards += quantity;
  } else {
    const rate = rateInF(rank, perRank);
    if (rate !== null) {
      const fVal = ((basis === 'cards' ? quantity : bank) / perCard) * rate;
      addToF(tally, rank, (basis === 'cards' ? quantity : bank) / perCard, perRank);
      tally.estimated.value += fVal;
      tally.estimated.shards += quantity;
    }
  }
}

const pricedEntry = (slug: string | null, db: Database): CardEntry | null => {
  const entry = slug ? db[slug] : undefined;
  return entry && typeof entry.price === 'number' && Number.isFinite(entry.price) ? entry : null;
};

function addToF(tally: Tally, rank: string, weight: number, perRank: number): void {
  const rate = rateInF(rank, perRank);
  if (rate === null) tally.beyondF = true;
  else tally.f += weight * rate;
}

function addCards(tally: Tally, { rank, price }: CardEntry, quantity: number, { commission, perRank, basis }: Pricing): void {
  const value = effectivePrice(price, commission) * quantity;
  const weight = basis === 'cards' ? quantity : value;
  addTo(tally.bank, rank, value);
  addTo(tally.count, rank, quantity);
  if (rank === R_RANK) {
    tally.r.value += weight;
    tally.r.count += quantity;
  } else if (rank === X_RANK) {
    tally.x.value += weight;
    tally.x.count += quantity;
  } else {
    addToF(tally, rank, weight, perRank);
  }
}

function addShards(tally: Tally, { rank, price }: CardEntry, quantity: number, { commission, perRank, basis, excludeShards }: Pricing): void {
  const perCard = SHARDS_REQUIRED[rank] || 1;
  const bank = effectivePrice(price, commission) * quantity;
  addTo(tally.shards, rank, quantity);
  addTo(tally.shardBank, rank, bank);
  if (excludeShards) return;
  if (rank === R_RANK) {
    tally.r.shards += quantity;
  } else if (rank === X_RANK) {
    tally.x.shards += quantity;
  } else {
    addToF(tally, rank, (basis === 'cards' ? quantity : bank) / perCard, perRank);
  }
}

function settle(tally: Tally, excludeShards: boolean): SideValue {
  const settled = tally.unknown === 0 && (excludeShards || tally.shardUnknown === 0);
  return {
    ...tally,
    r: { ...tally.r, complete: settled && tally.r.shards === 0 },
    x: { ...tally.x, complete: settled && tally.x.shards === 0 },
    estimated: { ...tally.estimated, complete: settled && tally.estimated.shards === 0 },
    complete: settled && !tally.beyondF,
  };
}

export function valueSide({ cards, hidden }: Side, db: Database, { commission, valueBySplit, valueBasis, excludeShards }: Valuation): SideValue {
  const pricing: Pricing = { commission, perRank: valueBySplit ? SPLIT_PER_RANK : CRAFT_PER_RANK, basis: valueBasis, excludeShards };
  const tally = emptyTally(hidden);
  for (const { slug, quantity, shard } of cards) {
    const entry = pricedEntry(slug, db);
    if (entry) (shard ? addShards : addCards)(tally, entry, quantity, pricing);
    else {
      const estimatedRank = extractRankFromSlug(slug);
      if (estimatedRank) {
        (shard ? addEstimatedShards : addEstimatedCards)(tally, estimatedRank, quantity, pricing);
      } else if (shard) {
        tally.shardUnknown += quantity;
      } else {
        tally.unknown += quantity;
      }
    }
  }
  return settle(tally, excludeShards);
}

export const hasR = ({ r }: Pick<SideValue, 'r'>): boolean => r.count > 0 || r.shards > 0;
export const hasX = ({ x }: Pick<SideValue, 'x'>): boolean => x.count > 0 || x.shards > 0;
export const hasEstimated = ({ estimated, estimatedBank, estimatedShardBank }: Pick<SideValue, 'estimated' | 'estimatedBank' | 'estimatedShardBank'>): boolean =>
  estimated.count > 0 || estimated.shards > 0 || (estimatedBank?.size ?? 0) > 0 || (estimatedShardBank?.size ?? 0) > 0;

export const hasSpecialTrade = (value: SideValue): boolean =>
  hasR(value) || hasX(value) || hasEstimated(value) || value.unknown > 0 || value.shardUnknown > 0;

export const formatAmount = (amount: number): string => String(+amount.toFixed(PRICE_DECIMALS));

export const formatByRank = (map: Map<string, number>): string[] =>
  [...map.keys()].sort((a, b) => rankPosition(a) - rankPosition(b)).map((rank) => `${formatAmount(map.get(rank) ?? 0)}${rank}`);

export const formatShardsByRank = (map: Map<string, number>): string[] =>
  [...map.keys()].sort((a, b) => rankPosition(a) - rankPosition(b)).map((rank) => `${formatAmount(map.get(rank) ?? 0)}${SHARD_MARK}${rank}`);

export const formatEstimatedByRank = (map?: Map<string, number>): string[] =>
  map
    ? [...map.keys()]
        .sort((a, b) => rankPosition(a) - rankPosition(b))
        .map((rank) => {
          const count = map.get(rank) ?? 0;
          return count > 1 ? `${count}${UNKNOWN_MARK}${rank}` : `${UNKNOWN_MARK}${rank}`;
        })
    : [];

export const formatEstimatedShardsByRank = (map?: Map<string, number>): string[] =>
  map
    ? [...map.keys()]
        .sort((a, b) => rankPosition(a) - rankPosition(b))
        .map((rank) => {
          const count = map.get(rank) ?? 0;
          return count > 1 ? `${count}${UNKNOWN_MARK}${SHARD_MARK}${rank}` : `${UNKNOWN_MARK}${SHARD_MARK}${rank}`;
        })
    : [];

export const formatBankWithEstimated = (bank: Map<string, number>, estimated?: Map<string, number>): string[] => {
  const est = estimated ?? new Map<string, number>();
  const ranks = [...new Set([...bank.keys(), ...est.keys()])].sort((a, b) => rankPosition(a) - rankPosition(b));
  const result: string[] = [];
  for (const rank of ranks) {
    const known = bank.get(rank);
    if (known !== undefined && known > 0) result.push(`${formatAmount(known)}${rank}`);
    const count = est.get(rank);
    if (count !== undefined && count > 0) result.push(count > 1 ? `${count}${UNKNOWN_MARK}${rank}` : `${UNKNOWN_MARK}${rank}`);
  }
  return result;
};

export const formatShardBankWithEstimated = (shardBank: Map<string, number>, estimated?: Map<string, number>): string[] => {
  const est = estimated ?? new Map<string, number>();
  const ranks = [...new Set([...shardBank.keys(), ...est.keys()])].sort((a, b) => rankPosition(a) - rankPosition(b));
  const result: string[] = [];
  for (const rank of ranks) {
    const known = shardBank.get(rank);
    if (known !== undefined && known > 0) result.push(`${formatAmount(known)}${SHARD_MARK}${rank}`);
    const count = est.get(rank);
    if (count !== undefined && count > 0) result.push(count > 1 ? `${count}${UNKNOWN_MARK}${SHARD_MARK}${rank}` : `${UNKNOWN_MARK}${SHARD_MARK}${rank}`);
  }
  return result;
};

const F_SCALE: Scale = { prefix: '', unit: F_UNIT };
const R_SCALE: Scale = { prefix: 'R: ', unit: R_RANK };
const X_SCALE: Scale = { prefix: 'X: ', unit: X_RANK };
const ESTIMATED_SCALE: Scale = { prefix: '?: ', unit: F_UNIT };

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

export const compareX = (give: Pick<SideValue, 'x'>, get: Pick<SideValue, 'x'>): Verdict | null =>
  hasX(give) || hasX(get) ? compare(give.x.value, get.x.value, priced(give.x.value, give.x.complete) && priced(get.x.value, get.x.complete), X_SCALE) : null;

export const compareEstimated = (give: Pick<SideValue, 'estimated' | 'estimatedBank' | 'estimatedShardBank'>, get: Pick<SideValue, 'estimated' | 'estimatedBank' | 'estimatedShardBank'>): Verdict | null =>
  hasEstimated(give) || hasEstimated(get)
    ? compare(give.estimated.value, get.estimated.value, priced(give.estimated.value, give.estimated.complete) && priced(get.estimated.value, get.estimated.complete), ESTIMATED_SCALE)
    : null;
