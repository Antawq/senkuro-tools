import { CURSOR_KEY, stableJson, type Variables } from './list-families';

const FIELD_PREFIX = 'SENKUTOOLS_PRICE';
const CURSOR_PREFIX = 'senkutools:price:';
const CURSOR_SEPARATOR = ':';
const DIRECTION_KEY = 'orderDirection';
const WHOLE_NUMBER = /^\d+$/;

export interface PrivateCursor {
  version: number;
  offset: number;
}

export const privateFieldOf = (version: number): string => `${FIELD_PREFIX}_${version}`;

export const isPrivateField = (field: unknown): boolean => typeof field === 'string' && field.startsWith(FIELD_PREFIX);

export const isPrivateVariables = (variables: Variables): boolean => isPrivateField(variables.orderField);

export const mentionsPrivateField = (text: string): boolean => text.includes(FIELD_PREFIX);

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

export const variableNamesOf = (variables: Variables): string =>
  Object.keys(variables)
    .filter((name) => name !== CURSOR_KEY)
    .sort()
    .join();

export function privateVariablesOf(variables: Variables, version: number): Variables {
  const cursor = readCursor(variables[CURSOR_KEY]);
  return { ...variables, orderField: privateFieldOf(version), [CURSOR_KEY]: cursor?.version === version ? variables[CURSOR_KEY] : null };
}

export const realVariablesOf = (variables: Variables): Variables =>
  hasPrivateCursor(variables[CURSOR_KEY]) ? { ...variables, [CURSOR_KEY]: null } : variables;
