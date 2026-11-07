import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { MEMORY_PLACES, MEMORY_VERSION, NO_MEMORY, createFilterMemory, placeMemoryOf, type MemoryStorage } from '../utils/shared/filter-memory';

const storageOf = (initial: unknown = undefined): { storage: MemoryStorage; writes: unknown[] } => {
  const writes: unknown[] = [];
  return {
    writes,
    storage: {
      read: () => Promise.resolve(initial),
      write: (value) => {
        writes.push(value);
        return Promise.resolve();
      },
    },
  };
};

const savedOf = (places: Record<string, unknown>): unknown => ({ version: MEMORY_VERSION, places });

describe('placeMemoryOf', () => {
  it('keeps a valid record as it is', () => {
    const record = {
      sort: 'RANK',
      direction: 'ASC',
      ranks: ['S', 'A'],
      colors: ['Белый'],
      isAnimated: true,
      isExplicit: true,
      tab: 'shards',
      range: { min: 1, max: 5 },
      shardView: 'cards',
      lock: 'locked',
    };
    expect(placeMemoryOf(record)).toEqual(record);
  });

  it('falls back to the empty memory for anything that is not a record', () => {
    for (const value of [undefined, null, 'text', 4, [], [1]]) expect(placeMemoryOf(value)).toEqual(NO_MEMORY);
  });

  it('drops each invalid field on its own and keeps the valid ones', () => {
    const memory = placeMemoryOf({
      sort: 'bad sort!',
      direction: 'UP',
      ranks: 'S',
      colors: [1, '', 'x'.repeat(41), 'Серый'],
      isAnimated: 'yes',
      tab: 'both',
      lock: 'some',
      shardView: 'x',
      range: 7,
    });
    expect(memory).toEqual({ ...NO_MEMORY, colors: ['Серый'] });
  });

  it('accepts the price sort next to the site fields', () => {
    expect(placeMemoryOf({ sort: 'price' }).sort).toBe('price');
    expect(placeMemoryOf({ sort: 'POPULARITY_SCORE' }).sort).toBe('POPULARITY_SCORE');
  });

  it('removes duplicate tags and caps their number', () => {
    expect(placeMemoryOf({ ranks: ['S', 'S', 'A'] }).ranks).toEqual(['S', 'A']);
    const many = Array.from({ length: 60 }, (_, index) => `c${index}`);
    expect(placeMemoryOf({ colors: many }).colors).toEqual(many.slice(0, 40));
  });

  it('accepts a half open range and refuses an empty, reversed or non finite one', () => {
    expect(placeMemoryOf({ range: { min: 2, max: null } }).range).toEqual({ min: 2, max: null });
    expect(placeMemoryOf({ range: { min: null, max: 3 } }).range).toEqual({ min: null, max: 3 });
    for (const range of [{ min: null, max: null }, { min: 5, max: 1 }, { min: Infinity, max: null }, { min: '1', max: '2' }, {}])
      expect(placeMemoryOf({ range }).range).toBeNull();
  });
});

describe('createFilterMemory', () => {
  it('knows nothing before it is loaded and then reads what was saved', async () => {
    const { storage } = storageOf(savedOf({ grid: { sort: 'RANK', direction: 'DESC' } }));
    const memory = createFilterMemory(storage);
    expect(memory.isLoaded()).toBe(false);
    expect(memory.get('grid')).toBeNull();
    await memory.load();
    expect(memory.isLoaded()).toBe(true);
    expect(memory.get('grid')).toEqual({ ...NO_MEMORY, sort: 'RANK', direction: 'DESC' });
    expect(memory.get('deck')).toBeNull();
  });

  it('starts empty when the stored value is missing, of another version or broken', async () => {
    for (const stored of [
      undefined,
      null,
      'x',
      { version: 2, places: { grid: { sort: 'RANK' } } },
      { version: MEMORY_VERSION },
      { version: MEMORY_VERSION, places: [] },
    ]) {
      const memory = createFilterMemory(storageOf(stored).storage);
      await memory.load();
      expect(MEMORY_PLACES.map((place) => memory.get(place))).toEqual(MEMORY_PLACES.map(() => null));
    }
  });

  it('starts empty and loaded when reading the storage fails', async () => {
    const memory = createFilterMemory({ read: () => Promise.reject(new Error('blocked')), write: () => Promise.resolve() });
    await memory.load();
    expect(memory.isLoaded()).toBe(true);
    expect(memory.get('grid')).toBeNull();
  });

  it('ignores places it does not know and keeps the known ones', async () => {
    const { storage } = storageOf(savedOf({ grid: { sort: 'RANK' }, window: { sort: 'RANK' }, deck: 'text' }));
    const memory = createFilterMemory(storage);
    await memory.load();
    expect(memory.get('grid')?.sort).toBe('RANK');
    expect(memory.get('deck')).toBeNull();
  });

  it('merges a patch into the place and saves the whole memory with its version', async () => {
    const { storage, writes } = storageOf(savedOf({ grid: { sort: 'RANK', ranks: ['S'] } }));
    const memory = createFilterMemory(storage);
    await memory.load();
    memory.update('grid', { direction: 'ASC' });
    memory.update('trade', { colors: ['Белый'] });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(memory.get('grid')).toEqual({ ...NO_MEMORY, sort: 'RANK', ranks: ['S'], direction: 'ASC' });
    expect(writes[1]).toEqual({
      version: MEMORY_VERSION,
      places: { grid: { ...NO_MEMORY, sort: 'RANK', ranks: ['S'], direction: 'ASC' }, trade: { ...NO_MEMORY, colors: ['Белый'] } },
    });
  });

  it('validates a patch the same way as stored data', async () => {
    const memory = createFilterMemory(storageOf().storage);
    await memory.load();
    memory.update('deck', { sort: 'not valid!', ranks: ['S', 'S'], direction: 'ASC' });
    expect(memory.get('deck')).toEqual({ ...NO_MEMORY, ranks: ['S'], direction: 'ASC' });
  });

  it('does not save or remember anything that is updated before the load', () => {
    const { storage, writes } = storageOf();
    const memory = createFilterMemory(storage);
    memory.update('grid', { sort: 'RANK' });
    expect(writes).toHaveLength(0);
    expect(memory.get('grid')).toBeNull();
  });

  it('writes in the order of the updates and survives a failed write', async () => {
    const writes: unknown[] = [];
    let failFirst = true;
    const storage: MemoryStorage = {
      read: () => Promise.resolve(undefined),
      write: (value) => {
        writes.push(value);
        if (failFirst) {
          failFirst = false;
          return Promise.reject(new Error('quota'));
        }
        return Promise.resolve();
      },
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const memory = createFilterMemory(storage);
    await memory.load();
    memory.update('grid', { sort: 'RANK' });
    memory.update('grid', { direction: 'ASC' });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((value) => (value as { places: { grid: { direction: string | null } } }).places.grid.direction)).toEqual([null, 'ASC']);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('persists to local:filterMemory when no custom storage is passed', async () => {
    fakeBrowser.reset();
    const first = createFilterMemory();
    await first.load();
    first.update('grid', { sort: 'RANK', ranks: ['S'] });
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get('filterMemory')).toHaveProperty('filterMemory'));
    const second = createFilterMemory();
    await second.load();
    expect(second.get('grid')).toEqual({ ...NO_MEMORY, sort: 'RANK', ranks: ['S'] });
  });
});
