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

interface RValue {
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
  excludeShards: boolean;
}

export const R_RANK = 'R';
export const SHARD_MARK = 'o';
export const UNKNOWN_MARK = '?';
export const UNKNOWN_LEGEND = `${UNKNOWN_MARK} - нет цены в базе`;
export const F_UNIT = 'F';

const FORGE_LADDER = [F_UNIT, 'D', 'C', 'B', 'A', 'S'];
const RANK_ORDER = [R_RANK, ...[...FORGE_LADDER].reverse()];

export const CRAFT_PER_RANK = 3;
export const SPLIT_PER_RANK = 2;

const SHARDS_REQUIRED: Record<string, number> = { S: 10, A: 8, B: 6, C: 4, D: 2 };

const rateInF = (rank: string | undefined, perRank: number): number | null => {
  const step = rank ? FORGE_LADDER.indexOf(rank) : -1;
  return step === -1 ? null : perRank ** step;
};

const rankPosition = (rank: string): number => {
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

type Tally = Omit<SideValue, 'r' | 'complete'> & { r: Omit<RValue, 'complete'> };

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
});

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
  if (rank !== R_RANK) addToF(tally, rank, weight, perRank);
  else {
    tally.r.value += weight;
    tally.r.count += quantity;
  }
}

function addShards(tally: Tally, { rank, price }: CardEntry, quantity: number, { commission, perRank, basis, excludeShards }: Pricing): void {
  const perCard = SHARDS_REQUIRED[rank] || 1;
  const bank = effectivePrice(price, commission) * quantity;
  addTo(tally.shards, rank, quantity);
  addTo(tally.shardBank, rank, bank);
  if (excludeShards) return;
  if (rank !== R_RANK) addToF(tally, rank, (basis === 'cards' ? quantity : bank) / perCard, perRank);
  else tally.r.shards += quantity;
}

function settle(tally: Tally, excludeShards: boolean): SideValue {
  const settled = tally.unknown === 0 && (excludeShards || tally.shardUnknown === 0);
  return {
    ...tally,
    r: { ...tally.r, complete: settled && tally.r.shards === 0 },
    complete: settled && !tally.beyondF,
  };
}

export function valueSide({ cards, hidden }: Side, db: Database, { commission, valueBySplit, valueBasis, excludeShards }: Valuation): SideValue {
  const pricing: Pricing = { commission, perRank: valueBySplit ? SPLIT_PER_RANK : CRAFT_PER_RANK, basis: valueBasis, excludeShards };
  const tally = emptyTally(hidden);
  for (const { slug, quantity, shard } of cards) {
    const entry = pricedEntry(slug, db);
    if (entry) (shard ? addShards : addCards)(tally, entry, quantity, pricing);
    else if (shard) tally.shardUnknown += quantity;
    else tally.unknown += quantity;
  }
  return settle(tally, excludeShards);
}

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
