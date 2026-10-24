import { parseJson } from './json';

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

const readDetail = (event: Event): Record<string, unknown> | null => {
  const detail = (event as CustomEvent<unknown>).detail;
  const parsed = typeof detail === 'string' ? parseJson(detail) : null;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
};

const isCount = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;

const isCountList = (candidate: unknown): candidate is number[] => Array.isArray(candidate) && candidate.every(isCount);

const isSlugList = (candidate: unknown): candidate is (string | null)[] =>
  Array.isArray(candidate) && candidate.every((slug) => slug === null || typeof slug === 'string');

export const encodePriceSwitch = (isOn: boolean): string => JSON.stringify({ isOn });

export const readPriceSwitch = (event: Event): boolean | null => {
  const detail = readDetail(event);
  return typeof detail?.isOn === 'boolean' ? detail.isOn : null;
};

export const encodePriceState = (state: PriceState): string => JSON.stringify(state);

export function readPriceState(event: Event): PriceState | null {
  const detail = readDetail(event);
  if (!detail || !STATE_NAMES.includes(detail.name) || !isCount(detail.loaded)) return null;
  return { name: detail.name as PriceStateName, loaded: detail.loaded, total: isCount(detail.total) ? detail.total : null };
}

export const encodePriceRows = (rows: PriceRows): string => JSON.stringify(rows);

export function readPriceRows(event: Event): PriceRows | null {
  const detail = readDetail(event);
  return detail && isCount(detail.viewId) && isSlugList(detail.slugs) ? { viewId: detail.viewId, slugs: detail.slugs } : null;
}

export const encodePriceOrder = (order: PriceOrder): string => JSON.stringify(order);

export function readPriceOrder(event: Event): PriceOrder | null {
  const detail = readDetail(event);
  if (!detail || !isCount(detail.viewId) || !isCount(detail.revision) || !isCountList(detail.descending) || !isCountList(detail.ascending)) return null;
  return { viewId: detail.viewId, revision: detail.revision, descending: detail.descending, ascending: detail.ascending };
}
