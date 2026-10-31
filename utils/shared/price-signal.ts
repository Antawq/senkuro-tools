import { isListScope, type ListScope } from './list-scope';
import { defineSignal } from './signal';

export type PriceStateName = 'loading' | 'ready' | 'unavailable' | 'failed';

const STATE_NAMES: readonly unknown[] = ['loading', 'ready', 'unavailable', 'failed'];

export type ViewSort = 'price' | 'site';

const VIEW_SORTS: readonly unknown[] = ['price', 'site'];

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
  sort: ViewSort;
}

export interface ScopedState extends PriceState {
  scope: ListScope;
}

export interface ScopedRows extends PriceRows {
  scope: ListScope;
}

export interface ScopedOrder extends PriceOrder {
  scope: ListScope;
}

const isCount = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;

const isCountList = (candidate: unknown): candidate is number[] => Array.isArray(candidate) && candidate.every(isCount);

const isSlugList = (candidate: unknown): candidate is (string | null)[] =>
  Array.isArray(candidate) && candidate.every((slug) => slug === null || typeof slug === 'string');

export const priceViewSignal = defineSignal<PriceSwitch>('senkutools:price-view', ({ scope, isOn, sort }) =>
  isListScope(scope) && typeof isOn === 'boolean' && VIEW_SORTS.includes(sort) ? { scope, isOn, sort: sort as ViewSort } : null
);

export const priceStateSignal = defineSignal<ScopedState>('senkutools:price-state', ({ scope, name, loaded, total }) =>
  isListScope(scope) && STATE_NAMES.includes(name) && isCount(loaded)
    ? { scope, name: name as PriceStateName, loaded, total: isCount(total) ? total : null }
    : null
);

export const priceRowsSignal = defineSignal<ScopedRows>('senkutools:price-rows', ({ scope, viewId, slugs }) =>
  isListScope(scope) && isCount(viewId) && isSlugList(slugs) ? { scope, viewId, slugs } : null
);

export const priceOrderSignal = defineSignal<ScopedOrder>('senkutools:price-order', ({ scope, viewId, revision, descending, ascending }) =>
  isListScope(scope) && isCount(viewId) && isCount(revision) && isCountList(descending) && isCountList(ascending)
    ? { scope, viewId, revision, descending, ascending }
    : null
);
