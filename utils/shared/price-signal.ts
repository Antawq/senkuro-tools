import { parseJson } from './json';
import { isListScope, type ListScope } from './list-scope';

export const PRICE_VIEW_EVENT = 'senkutools:price-view';
export const PRICE_STATE_EVENT = 'senkutools:price-state';
export const PRICE_ROWS_EVENT = 'senkutools:price-rows';
export const PRICE_ORDER_EVENT = 'senkutools:price-order';

export type PriceStateName = 'loading' | 'ready' | 'unavailable' | 'failed';

const STATE_NAMES: readonly unknown[] = ['loading', 'ready', 'unavailable', 'failed'];

export interface PriceState {
  name: PriceStateName;
  loaded: number;
  total: number | null;
}

export interface PriceRows {
  viewId: number;
  slugs: (string | null)[];
}

export interface PriceOrder {
  viewId: number;
  revision: number;
  descending: number[];
  ascending: number[];
}

export interface PriceSwitch {
  scope: ListScope;
  isOn: boolean;
}

export interface ScopedState {
  scope: ListScope;
  state: PriceState;
}

export interface ScopedRows {
  scope: ListScope;
  rows: PriceRows;
}

export interface ScopedOrder {
  scope: ListScope;
  order: PriceOrder;
}

interface ScopedDetail {
  scope: ListScope;
  detail: Record<string, unknown>;
}

const readDetail = (event: Event): ScopedDetail | null => {
  const raw = (event as CustomEvent<unknown>).detail;
  const parsed = typeof raw === 'string' ? parseJson(raw) : null;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const detail = parsed as Record<string, unknown>;
  return isListScope(detail.scope) ? { scope: detail.scope, detail } : null;
};

const isCount = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;

const isCountList = (candidate: unknown): candidate is number[] => Array.isArray(candidate) && candidate.every(isCount);

const isSlugList = (candidate: unknown): candidate is (string | null)[] =>
  Array.isArray(candidate) && candidate.every((slug) => slug === null || typeof slug === 'string');

export const encodePriceSwitch = ({ scope, isOn }: PriceSwitch): string => JSON.stringify({ scope, isOn });

export function readPriceSwitch(event: Event): PriceSwitch | null {
  const scoped = readDetail(event);
  if (!scoped || typeof scoped.detail.isOn !== 'boolean') return null;
  return { scope: scoped.scope, isOn: scoped.detail.isOn };
}

export const encodePriceState = ({ scope, state }: ScopedState): string => JSON.stringify({ scope, ...state });

export function readPriceState(event: Event): ScopedState | null {
  const scoped = readDetail(event);
  if (!scoped) return null;
  const { name, loaded, total } = scoped.detail;
  if (!STATE_NAMES.includes(name) || !isCount(loaded)) return null;
  return { scope: scoped.scope, state: { name: name as PriceStateName, loaded, total: isCount(total) ? total : null } };
}

export const encodePriceRows = ({ scope, rows }: ScopedRows): string => JSON.stringify({ scope, ...rows });

export function readPriceRows(event: Event): ScopedRows | null {
  const scoped = readDetail(event);
  if (!scoped) return null;
  const { viewId, slugs } = scoped.detail;
  return isCount(viewId) && isSlugList(slugs) ? { scope: scoped.scope, rows: { viewId, slugs } } : null;
}

export const encodePriceOrder = ({ scope, order }: ScopedOrder): string => JSON.stringify({ scope, ...order });

export function readPriceOrder(event: Event): ScopedOrder | null {
  const scoped = readDetail(event);
  if (!scoped) return null;
  const { viewId, revision, descending, ascending } = scoped.detail;
  if (!isCount(viewId) || !isCount(revision) || !isCountList(descending) || !isCountList(ascending)) return null;
  return { scope: scoped.scope, order: { viewId, revision, descending, ascending } };
}
