import { storage } from 'wxt/utils/storage';

export const MEMORY_PLACES = ['grid', 'deck', 'trade', 'upgrade', 'split', 'merge'] as const;

export type MemoryPlace = (typeof MEMORY_PLACES)[number];
export type MemoryDirection = 'ASC' | 'DESC';
export type MemoryTab = 'cards' | 'shards';
export type MemoryShardView = 'all' | 'cards' | 'shards';
export type MemoryLockView = 'all' | 'unlocked' | 'locked';

export interface MemoryRange {
  min: number | null;
  max: number | null;
}

export interface PlaceMemory {
  sort: string | null;
  direction: MemoryDirection | null;
  ranks: string[];
  colors: string[];
  isAnimated: boolean;
  isExplicit: boolean;
  tab: MemoryTab | null;
  range: MemoryRange | null;
  shardView: MemoryShardView | null;
  lock: MemoryLockView | null;
}

export interface MemoryStorage {
  read: () => Promise<unknown>;
  write: (value: unknown) => Promise<void>;
}

export interface FilterMemory {
  load: () => Promise<void>;
  isLoaded: () => boolean;
  get: (place: MemoryPlace) => PlaceMemory | null;
  update: (place: MemoryPlace, patch: Partial<PlaceMemory>) => void;
}

export const MEMORY_VERSION = 1;

export const NO_MEMORY: PlaceMemory = {
  sort: null,
  direction: null,
  ranks: [],
  colors: [],
  isAnimated: false,
  isExplicit: false,
  tab: null,
  range: null,
  shardView: null,
  lock: null,
};

const SORT_FORMAT = /^[A-Za-z_]{1,40}$/;
const MAX_TAGS = 40;
const MAX_TAG_LENGTH = 40;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const oneOf = <Value extends string>(value: unknown, allowed: readonly Value[]): Value | null => allowed.find((candidate) => candidate === value) ?? null;

const sortOf = (value: unknown): string | null => (typeof value === 'string' && SORT_FORMAT.test(value) ? value : null);

function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= MAX_TAG_LENGTH);
  return [...new Set(tags)].slice(0, MAX_TAGS);
}

const boundOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function rangeOf(value: unknown): MemoryRange | null {
  if (!isRecord(value)) return null;
  const min = boundOf(value.min);
  const max = boundOf(value.max);
  if (min === null && max === null) return null;
  return min !== null && max !== null && min > max ? null : { min, max };
}

export function placeMemoryOf(value: unknown): PlaceMemory {
  const source = isRecord(value) ? value : {};
  return {
    sort: sortOf(source.sort),
    direction: oneOf(source.direction, ['ASC', 'DESC']),
    ranks: tagsOf(source.ranks),
    colors: tagsOf(source.colors),
    isAnimated: source.isAnimated === true,
    isExplicit: source.isExplicit === true,
    tab: oneOf(source.tab, ['cards', 'shards']),
    range: rangeOf(source.range),
    shardView: oneOf(source.shardView, ['all', 'cards', 'shards']),
    lock: oneOf(source.lock, ['all', 'unlocked', 'locked']),
  };
}

type Places = Partial<Record<MemoryPlace, PlaceMemory>>;

function placesOf(raw: unknown): Places {
  if (!isRecord(raw) || raw.version !== MEMORY_VERSION || !isRecord(raw.places)) return {};
  const saved = raw.places;
  const places: Places = {};
  for (const place of MEMORY_PLACES) if (isRecord(saved[place])) places[place] = placeMemoryOf(saved[place]);
  return places;
}

const STORED_MEMORY = storage.defineItem<unknown>('local:filterMemory');

const defaultStorage: MemoryStorage = {
  read: () => STORED_MEMORY.getValue(),
  write: (value) => STORED_MEMORY.setValue(value),
};

export function createFilterMemory(backing: MemoryStorage = defaultStorage): FilterMemory {
  let places: Places = {};
  let isLoaded = false;
  let pending: Promise<void> = Promise.resolve();
  const save = (): void => {
    const snapshot = { version: MEMORY_VERSION, places: { ...places } };
    pending = pending.then(() => backing.write(snapshot)).catch((error: unknown) => console.error('SenkuTools: filter memory not saved', error));
  };
  return {
    async load() {
      places = await backing.read().then(placesOf, () => ({}));
      isLoaded = true;
    },
    isLoaded: () => isLoaded,
    get: (place) => (isLoaded ? (places[place] ?? null) : null),
    update(place, patch) {
      if (!isLoaded) return;
      places[place] = placeMemoryOf({ ...(places[place] ?? NO_MEMORY), ...patch });
      save();
    },
  };
}
