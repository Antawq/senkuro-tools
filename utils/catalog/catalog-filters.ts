import type { CatalogKind, FilterSpec } from './catalog-results';
import { isCatalogRow, type CatalogRow } from './catalog-row';

interface MembersRule {
  kind: 'one' | 'all';
  include: string[];
  exclude: string[];
}

interface LabelRule {
  kind: 'label';
  include: string[];
  exclude: string[];
  isAny: boolean;
}

interface CountRule {
  kind: 'count';
  start: number | null;
  end: number | null;
}

interface DateRule {
  kind: 'date';
  start: string | null;
  end: string | null;
}

type Rule = MembersRule | LabelRule | CountRule | DateRule;

interface Condition {
  fact: string;
  rule: Rule;
}

export type CatalogFilters = readonly Condition[];

export interface SearchRequest {
  text: string;
  filters: CatalogFilters;
}

const SEARCH_VARIABLE = 'search';
const IGNORED_VARIABLES: ReadonlySet<string> = new Set([SEARCH_VARIABLE, 'orderField', 'orderDirection', 'first']);
const ANY_MODE = 'ANY';
const ALL_MODE = 'ALL';
const WHOLE_NUMBER = /^-?\d+$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isCatalogRow(value) && Object.values(value).every(isEmptyValue);
};

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const listOf = (value: unknown): string[] | null => {
  if (value === undefined || value === null) return [];
  return isStrings(value) ? value : null;
};

const countOf = (value: unknown): number | null | undefined => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'string' && WHOLE_NUMBER.test(value) ? Number(value) : undefined;
};

const dateOf = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && CALENDAR_DATE.test(value) ? value : undefined;
};

function membersRuleOf(kind: 'one' | 'all', { include, exclude, ...rest }: CatalogRow): MembersRule | null {
  const included = listOf(include);
  const excluded = listOf(exclude);
  return included && excluded && Object.values(rest).every(isEmptyValue) ? { kind, include: included, exclude: excluded } : null;
}

function labelRuleOf({ include, exclude, mode, ...rest }: CatalogRow): LabelRule | null {
  const included = listOf(include);
  const excluded = listOf(exclude);
  const isKnownMode = mode === undefined || mode === null || mode === ANY_MODE || mode === ALL_MODE;
  return included && excluded && isKnownMode && Object.values(rest).every(isEmptyValue)
    ? { kind: 'label', include: included, exclude: excluded, isAny: mode === ANY_MODE }
    : null;
}

function countRuleOf({ start, end, ...rest }: CatalogRow): CountRule | null {
  const first = countOf(start);
  const last = countOf(end);
  return first !== undefined && last !== undefined && Object.values(rest).every(isEmptyValue) ? { kind: 'count', start: first, end: last } : null;
}

function dateRuleOf({ start, end, ...rest }: CatalogRow): DateRule | null {
  const first = dateOf(start);
  const last = dateOf(end);
  return first !== undefined && last !== undefined && Object.values(rest).every(isEmptyValue) ? { kind: 'date', start: first, end: last } : null;
}

const ruleOf = ({ rule }: FilterSpec, value: CatalogRow): Rule | null => {
  if (rule === 'label') return labelRuleOf(value);
  if (rule === 'count') return countRuleOf(value);
  return rule === 'date' ? dateRuleOf(value) : membersRuleOf(rule, value);
};

function conditionOf(spec: FilterSpec | undefined, value: unknown): Condition | null {
  if (!spec || !isCatalogRow(value)) return null;
  const rule = ruleOf(spec, value);
  return rule ? { fact: spec.fact, rule } : null;
}

export function searchRequestOf(variables: CatalogRow | undefined, kind: CatalogKind): SearchRequest | null {
  const text = variables?.[SEARCH_VARIABLE];
  if (!variables || typeof text !== 'string' || text.trim() === '') return null;
  const filters: Condition[] = [];
  for (const [name, value] of Object.entries(variables)) {
    if (IGNORED_VARIABLES.has(name) || isEmptyValue(value)) continue;
    const condition = conditionOf(kind.filters[name], value);
    if (!condition) return null;
    filters.push(condition);
  }
  return { text: text.trim(), filters };
}

const hasEvery = (members: readonly string[], wanted: readonly string[]): boolean => wanted.every((item) => members.includes(item));

const hasSome = (members: readonly string[], wanted: readonly string[]): boolean => wanted.some((item) => members.includes(item));

const memberOf = (item: unknown): string[] => {
  const member = isCatalogRow(item) ? item.slug : item;
  return typeof member === 'string' ? [member] : [];
};

const membersOf = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).flatMap(memberOf) : []);

function passesOne({ include, exclude }: MembersRule, value: unknown): boolean {
  if (include.length === 0 && exclude.length === 0) return true;
  if (typeof value !== 'string') return false;
  return (include.length === 0 || include.includes(value)) && (exclude.length === 0 || !exclude.includes(value));
}

const passesAll = ({ include, exclude }: MembersRule, members: readonly string[]): boolean =>
  (include.length === 0 || hasEvery(members, include)) && (exclude.length === 0 || !hasEvery(members, exclude));

function passesLabel({ include, exclude, isAny }: LabelRule, members: readonly string[]): boolean {
  const isIncluded = include.length === 0 || (isAny ? hasSome(members, include) : hasEvery(members, include));
  return isIncluded && (exclude.length === 0 || !hasSome(members, exclude));
}

function passesCount({ start, end }: CountRule, value: unknown): boolean {
  if (start === null && end === null) return true;
  return typeof value === 'number' && (start === null || value >= start) && (end === null || value <= end);
}

function passesDate({ start, end }: DateRule, value: unknown): boolean {
  if (start === null && end === null) return true;
  return typeof value === 'string' && (start === null || value >= start) && (end === null || value <= end);
}

function passesCondition({ fact, rule }: Condition, facts: CatalogRow): boolean {
  const value = facts[fact];
  if (rule.kind === 'count') return passesCount(rule, value);
  if (rule.kind === 'date') return passesDate(rule, value);
  if (rule.kind === 'label') return passesLabel(rule, membersOf(value));
  return rule.kind === 'one' ? passesOne(rule, value) : passesAll(rule, membersOf(value));
}

export const rowPasses = (facts: CatalogRow | undefined, filters: CatalogFilters): boolean =>
  filters.length === 0 || (facts !== undefined && filters.every((condition) => passesCondition(condition, facts)));
