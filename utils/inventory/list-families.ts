export const LIST_OPERATION = 'fetchUserCards';

const CURSOR_KEY = 'after';
const NEWEST_FIRST_FIELD = 'CREATED_AT';
const NEWEST_FIRST_DIRECTION = 'DESC';
const UNJUDGEABLE_FILTERS = ['quantity', 'label', 'color', 'author', 'character', 'entity', 'locked', 'audio', 'wants', 'bookmark'];

export type Variables = Record<string, unknown>;

export interface PageRequest {
  document: unknown;
  variables: Variables;
  options: Record<string, unknown>;
}

export interface Family {
  id: string;
  filters: Variables;
  pages: PageRequest[];
  route?: string;
}

export interface ReceivedCard {
  modifier?: number;
  card?: { rank?: string; animated?: boolean; explicit?: boolean };
}

export interface RawPage {
  endCursor: string | null;
  hasNextPage: boolean;
  ids: Set<string>;
}

export type Verdict = 'match' | 'exclude' | 'unknown';

interface ListFilter {
  include?: unknown[];
  exclude?: unknown[];
}

interface RawAnswer {
  data?: { userCards?: { pageInfo?: { endCursor?: unknown; hasNextPage?: unknown }; edges?: unknown } | null } | null;
}

interface RawEdge {
  node?: { modifier?: unknown; card?: { id?: unknown } | null } | null;
}

const sortKeys = (_key: string, value: unknown): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
    : value;

const stable = (value: unknown): string => JSON.stringify(value, sortKeys);

const withoutCursor = (variables: Variables): Variables => Object.fromEntries(Object.entries(variables).filter(([key]) => key !== CURSOR_KEY));

export const familyIdOf = (variables: Variables): string => stable(withoutCursor(variables));

const hasCursor = (variables: Variables): boolean => variables[CURSOR_KEY] != null;

export const pageIdOf = (variables: Variables): string => stable(hasCursor(variables) ? variables : withoutCursor(variables));

export const isNewestFirst = (filters: Variables): boolean =>
  (filters.orderField == null || filters.orderField === NEWEST_FIRST_FIELD) &&
  (filters.orderDirection == null || filters.orderDirection === NEWEST_FIRST_DIRECTION);

const asFilter = (value: unknown): ListFilter | null => (value && typeof value === 'object' ? value : null);

const outside = (filter: ListFilter | null, value: unknown): boolean => {
  if (!filter) return false;
  if (filter.exclude?.includes(value)) return true;
  return Boolean(filter.include?.length) && !filter.include?.includes(value);
};

const isEmptyFilter = (value: unknown): boolean =>
  value == null || (typeof value === 'object' && Object.values(value).every((part) => part == null || (Array.isArray(part) && part.length === 0)));

const animatedExcludes = (wanted: unknown, actual: boolean | undefined): boolean =>
  (wanted === false && actual === true) || (wanted === true && actual !== true);

const explicitExcludes = (wanted: unknown, actual: boolean | undefined): boolean =>
  (wanted === false && actual === true) || (wanted === true && actual === false);

export function judge(filters: Variables, entry: ReceivedCard): Verdict {
  const card = entry.card;
  if (typeof card?.rank !== 'string') return 'unknown';
  if (outside(asFilter(filters.rank), card.rank) || outside(asFilter(filters.modifier), entry.modifier)) return 'exclude';
  if (animatedExcludes(filters.animated, card.animated) || explicitExcludes(filters.explicit, card.explicit)) return 'exclude';
  return UNJUDGEABLE_FILTERS.some((name) => !isEmptyFilter(filters[name])) || !isNewestFirst(filters) ? 'unknown' : 'match';
}

export const needsRefresh = (family: Family, received: ReceivedCard[]): boolean =>
  !isNewestFirst(family.filters) || received.some((entry) => judge(family.filters, entry) !== 'match');

export const isGridFamily = (family: Family): boolean => Array.isArray(asFilter(family.filters.modifier)?.include);

export const isPickerFamily = (family: Family): boolean => Array.isArray(asFilter(family.filters.modifier)?.exclude);

const idOf = (edge: RawEdge): string | null => {
  const id = edge.node?.card?.id;
  const modifier = edge.node?.modifier;
  return typeof id === 'string' ? `${id}:${typeof modifier === 'number' ? modifier : 0}` : null;
};

export function readRawPage(answer: unknown): RawPage | null {
  const list = (answer as RawAnswer | null)?.data?.userCards;
  if (!list || !Array.isArray(list.edges)) return null;
  const ids = (list.edges as RawEdge[]).map(idOf).filter((id): id is string => id !== null);
  const { endCursor, hasNextPage } = list.pageInfo ?? {};
  return { endCursor: typeof endCursor === 'string' ? endCursor : null, hasNextPage: hasNextPage === true, ids: new Set(ids) };
}

const shares = (left: Set<string>, right: Set<string>): boolean => [...right].some((id) => left.has(id));

export const linked = (current: RawPage, nextCursor: unknown, next: RawPage): boolean =>
  current.endCursor === nextCursor || next.ids.size === 0 || shares(current.ids, next.ids);

export interface ListRecord {
  record(page: PageRequest, route?: string): void;
  families(): Family[];
  insertAfter(family: Family, anchor: PageRequest, pages: PageRequest[]): void;
}

const knows = (family: Family, page: PageRequest): boolean => family.pages.some((known) => pageIdOf(known.variables) === pageIdOf(page.variables));

export function createListRecord(): ListRecord {
  const known = new Map<string, Family>();
  return {
    record(page, route) {
      const id = familyIdOf(page.variables);
      const family = known.get(id) ?? { id, filters: withoutCursor(page.variables), pages: [] };
      known.set(id, family);
      if (route !== undefined) family.route = route;
      if (!knows(family, page)) family.pages.push(page);
      if (!family.pages.some((known) => !hasCursor(known.variables))) family.pages.unshift({ ...page, variables: family.filters });
    },
    families: () => [...known.values()],
    insertAfter(family, anchor, pages) {
      const fresh = pages.filter((page) => !knows(family, page));
      const at = family.pages.indexOf(anchor);
      family.pages.splice(at < 0 ? family.pages.length : at + 1, 0, ...fresh);
    },
  };
}
