import type { AccountCard } from './account-cards';
import type { Database } from './database';
import { formatByRank, hasR, valueSide } from './trade-value';

export interface AccountR {
  cards: number;
  coins: number;
  shards: number;
}

export interface AccountSummary {
  cards: number;
  unique: number;
  shards: number;
  unpriced: number;
  bank: number;
  bankByRank: string[];
  cardsByRank: string[];
  r: AccountR | null;
}

const R_RANK = 'R';

const sum = (values: Iterable<number>): number => [...values].reduce((total, value) => total + value, 0);

const withoutR = (map: Map<string, number>): Map<string, number> => new Map([...map].filter(([rank]) => rank !== R_RANK));

export function summarizeAccount(inventory: AccountCard[], db: Database, commission: boolean): AccountSummary {
  const value = valueSide({ cards: inventory, hidden: 0 }, db, commission);
  const whole = inventory.filter(({ shard }) => !shard);
  const bank = withoutR(value.bank);
  return {
    cards: sum(whole.map(({ quantity }) => quantity)),
    unique: new Set(whole.map(({ slug }) => slug)).size,
    shards: sum(inventory.filter(({ shard }) => shard).map(({ quantity }) => quantity)),
    unpriced: value.unknown,
    bank: sum(bank.values()),
    bankByRank: formatByRank(bank),
    cardsByRank: formatByRank(withoutR(value.count)),
    r: hasR(value) ? { cards: value.r.count, coins: value.r.value, shards: value.r.shards } : null,
  };
}
