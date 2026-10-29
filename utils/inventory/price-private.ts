import { CURSOR_KEY, stableJson, type Variables } from './list-families';

const CURSOR_PREFIX = 'senkutools:price:';
const CURSOR_SEPARATOR = ':';
const DIRECTION_KEY = 'orderDirection';
const WHOLE_NUMBER = /^\d+$/;

export interface PrivateCursor {
  version: number;
  offset: number;
}

export const createPrivateCursor = (version: number, offset: number): string => `${CURSOR_PREFIX}${version}${CURSOR_SEPARATOR}${offset}`;

export const hasPrivateCursor = (after: unknown): boolean => typeof after === 'string' && after.startsWith(CURSOR_PREFIX);

export function readCursor(after: unknown): PrivateCursor | null {
  if (!hasPrivateCursor(after)) return null;
  const [version, offset, ...rest] = (after as string).slice(CURSOR_PREFIX.length).split(CURSOR_SEPARATOR);
  if (rest.length > 0 || !WHOLE_NUMBER.test(version ?? '') || !WHOLE_NUMBER.test(offset ?? '')) return null;
  return { version: Number(version), offset: Number(offset) };
}

export const viewKeyOf = (variables: Variables): string =>
  stableJson(Object.fromEntries(Object.entries(variables).filter(([name]) => name !== CURSOR_KEY && name !== DIRECTION_KEY)));

const fieldNamesOf = (name: string, value: unknown): string[] =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).map((field) => `${name}.${field}`) : [];

export const variableNamesOf = (variables: Variables): string =>
  Object.entries(variables)
    .filter(([name]) => name !== CURSOR_KEY)
    .flatMap(([name, value]) => [name, ...fieldNamesOf(name, value)])
    .sort()
    .join();

export const realVariablesOf = (variables: Variables): Variables =>
  hasPrivateCursor(variables[CURSOR_KEY]) ? { ...variables, [CURSOR_KEY]: null } : variables;
