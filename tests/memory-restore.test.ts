import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MEMORY_VERSION, NO_MEMORY, createFilterMemory, type FilterMemory, type MemoryPlace, type PlaceMemory } from '../utils/shared/filter-memory';
import type { FrameWait } from '../utils/shared/frame-wait';
import { createMemoryRestore, type MemoryRestore, type MemoryRestoreHost } from '../utils/sort/memory-restore';
import { mountSiteToolbar, type FixtureKind, type SiteToolbar } from './helpers/site-toolbar';

const wait: FrameWait = (look) => Promise.resolve(look() ?? null);

let site: SiteToolbar | null = null;
let touched: Set<Element>;
let isReady: boolean;
let restoredOwn: { toolbar: Element; saved: PlaceMemory }[];

const memoryOf = async (places: Partial<Record<MemoryPlace, Partial<PlaceMemory>>>): Promise<FilterMemory> => {
  const saved = Object.fromEntries(Object.entries(places).map(([place, memory]) => [place, { ...NO_MEMORY, ...memory }]));
  const memory = createFilterMemory({ read: () => Promise.resolve({ version: MEMORY_VERSION, places: saved }), write: () => Promise.resolve() });
  await memory.load();
  return memory;
};

const restoreOf = (memory: FilterMemory, overrides: Partial<MemoryRestoreHost> = {}): MemoryRestore =>
  createMemoryRestore(document, memory, {
    isReady: () => isReady,
    hasTouched: (toolbar) => touched.has(toolbar),
    wait,
    restoreOwn: (toolbar, saved) => void restoredOwn.push({ toolbar, saved }),
    ...overrides,
  });

const mount = (kind: FixtureKind, overrides: Parameters<typeof mountSiteToolbar>[1] = {}): SiteToolbar => {
  site?.dispose();
  site = mountSiteToolbar(kind, overrides);
  return site;
};

const settle = async (): Promise<void> => {
  for (let step = 0; step < 20; step++) await Promise.resolve();
};

beforeEach(() => {
  touched = new Set();
  isReady = true;
  restoredOwn = [];
});

afterEach(() => {
  site?.dispose();
  site = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const EVERYTHING: Partial<PlaceMemory> = {
  sort: 'RANK',
  direction: 'ASC',
  ranks: ['S', 'A'],
  colors: ['Белый', 'Зелёный'],
  isAnimated: true,
  isExplicit: true,
  tab: 'shards',
};

describe('restoring what the user left on a toolbar', () => {
  it('replays every remembered choice in the inventory and then hands the toolbar to our own controls', async () => {
    const memory = await memoryOf({ grid: EVERYTHING });
    const { toolbar, state } = mount('grid');
    restoreOf(memory).sync();
    await settle();
    expect(state).toMatchObject({ sort: 'RANK', direction: 'ASC', isAnimated: true, isExplicit: true, tab: 'Осколки' });
    expect([...state.ranks]).toEqual(['S', 'A']);
    expect([...state.colors]).toEqual(['Белый', 'Зелёный']);
    expect(restoredOwn).toEqual([{ toolbar, saved: { ...NO_MEMORY, ...EVERYTHING } }]);
  });

  it.each([
    ['deck', 'deck'],
    ['window', 'trade'],
  ] as const)('restores the %s toolbar from the place %s', async (kind, place) => {
    const memory = await memoryOf({ [place]: { sort: 'QUANTITY', direction: 'ASC', ranks: ['F'] } });
    const { state } = mount(kind);
    restoreOf(memory).sync();
    await settle();
    expect(state).toMatchObject({ sort: 'QUANTITY', direction: 'ASC' });
    expect([...state.ranks]).toEqual(['F']);
  });

  it.each<[Partial<PlaceMemory>, Record<string, unknown>]>([
    [{ colors: ['Белый'] }, { colors: new Set(['Белый']) }],
    [{ isAnimated: true }, { isAnimated: true }],
    [{ isExplicit: true }, { isExplicit: true }],
  ])('opens the filter dropdown when only %o is remembered', async (savedFilter, expected) => {
    const memory = await memoryOf({ grid: savedFilter });
    const { state } = mount('grid');
    restoreOf(memory).sync();
    await settle();
    expect(state).toMatchObject(expected);
  });

  it('uses the memory of the forge mode a window is in', async () => {
    const memory = await memoryOf({ trade: { sort: 'RANK' }, merge: { sort: 'ENTITY' } });
    const { state } = mount('window');
    const hint = document.querySelector('.modal-trade__header-hint');
    if (hint) hint.textContent = 'Выбери 3 одинаковые карты для объединения в 1 анимированную';
    restoreOf(memory).sync();
    await settle();
    expect(state.sort).toBe('ENTITY');
  });

  it('restores a toolbar once, however often it is asked', async () => {
    const memory = await memoryOf({ grid: EVERYTHING });
    const { clicks } = mount('grid');
    const restore = restoreOf(memory);
    restore.sync();
    await settle();
    const done = clicks.length;
    restore.sync();
    restore.sync();
    await settle();
    expect(clicks).toHaveLength(done);
    expect(restoredOwn).toHaveLength(1);
  });

  it('restores a toolbar that replaces the one it restored before', async () => {
    const memory = await memoryOf({ grid: { direction: 'ASC' } });
    const restore = restoreOf(memory);
    mount('grid');
    restore.sync();
    await settle();
    const next = mount('grid');
    restore.sync();
    await settle();
    expect(next.state.direction).toBe('ASC');
  });

  it('restores only our own controls when a trade window recreates its toolbar inside the same modal after the preview step', async () => {
    const memory = await memoryOf({ trade: { sort: 'RANK', direction: 'ASC', ranks: ['S'] } });
    const restore = restoreOf(memory);
    const { toolbar, clicks } = mount('window');
    restore.sync();
    await settle();
    const initialClicks = clicks.length;
    expect(restoredOwn).toHaveLength(1);
    const replacement = toolbar.cloneNode(true) as HTMLElement;
    replacement.querySelector('.cards-cnt__nav-filter--asc')?.classList.remove('cards-cnt__nav-filter--asc');
    const replacementClicks: EventTarget[] = [];
    replacement.addEventListener('click', (event) => {
      if (event.target) replacementClicks.push(event.target);
    });
    toolbar.replaceWith(replacement);
    restore.sync();
    await settle();
    expect(clicks).toHaveLength(initialClicks);
    expect(replacementClicks).toEqual([]);
    expect(restoredOwn).toHaveLength(2);
    expect(restoredOwn[1]?.toolbar).toBe(replacement);
  });
});

describe('what a restore leaves alone', () => {
  it('opens no menu for the default sort or for the price sort, which our own controls restore', async () => {
    for (const sort of ['CREATED_AT', 'price']) {
      const memory = await memoryOf({ grid: { sort, ranks: ['S'] } });
      const { clicks } = mount('grid');
      restoreOf(memory).sync();
      await settle();
      expect(clicks.some((click) => click.startsWith('sort:'))).toBe(false);
      expect(document.getElementById('cards-browse-order')).toBeNull();
    }
  });

  it('does not flip a direction that is already the remembered one', async () => {
    const memory = await memoryOf({ deck: { direction: 'ASC' } });
    const { clicks, state } = mount('deck', { direction: 'ASC' });
    restoreOf(memory).sync();
    await settle();
    expect(clicks).toEqual([]);
    expect(state.direction).toBe('ASC');
  });

  it('opens no dropdown when no filter is remembered', async () => {
    const memory = await memoryOf({ grid: { sort: 'RANK' } });
    const { clicks } = mount('grid');
    restoreOf(memory).sync();
    await settle();
    expect(clicks).toEqual(['sort:RANK']);
  });

  it('does nothing before the app is mounted, then restores when it is', async () => {
    const memory = await memoryOf({ grid: { direction: 'ASC' } });
    const { state } = mount('grid');
    isReady = false;
    const restore = restoreOf(memory);
    restore.sync();
    await settle();
    expect(state.direction).toBe('DESC');
    isReady = true;
    restore.sync();
    await settle();
    expect(state.direction).toBe('ASC');
  });

  it('does nothing before the memory is loaded', async () => {
    const memory = createFilterMemory({ read: () => Promise.resolve(undefined), write: () => Promise.resolve() });
    const { clicks } = mount('grid');
    restoreOf(memory).sync();
    await settle();
    expect(clicks).toEqual([]);
  });

  it('does nothing for a place with nothing remembered, nor for a window it cannot name', async () => {
    const memory = await memoryOf({ deck: { sort: 'RANK' } });
    const { clicks } = mount('grid');
    restoreOf(memory).sync();
    mount('window');
    const header = document.querySelector('.modal-trade__header');
    if (header) header.textContent = 'Выбор карт из общего каталога';
    restoreOf(memory).sync();
    await settle();
    expect(clicks).toEqual([]);
    expect(restoredOwn).toEqual([]);
  });

  it('waits for a toolbar whose controls the site has not drawn yet', async () => {
    const memory = await memoryOf({ grid: { direction: 'ASC' } });
    const { toolbar, state } = mount('grid');
    const filterPopper = toolbar.querySelectorAll(':scope > .v-popper')[1];
    filterPopper?.remove();
    const restore = restoreOf(memory);
    restore.sync();
    expect(state.direction).toBe('DESC');
    if (filterPopper) toolbar.append(filterPopper);
    restore.sync();
    await settle();
    expect(state.direction).toBe('ASC');
  });
});

describe('when the user gets there first', () => {
  it('skips a toolbar the user touched before the restore started', async () => {
    const memory = await memoryOf({ grid: EVERYTHING });
    const { toolbar, clicks } = mount('grid');
    touched.add(toolbar);
    restoreOf(memory).sync();
    await settle();
    expect(clicks).toEqual([]);
    expect(restoredOwn).toEqual([]);
  });

  it('stops where it is when the user touches the toolbar in the middle', async () => {
    const memory = await memoryOf({ grid: EVERYTHING });
    const { toolbar, clicks } = mount('grid');
    const stopAfterSort: FrameWait = (look) => {
      const found = look() ?? null;
      touched.add(toolbar);
      return Promise.resolve(found);
    };
    restoreOf(memory, { wait: stopAfterSort }).sync();
    await settle();
    expect(clicks).toContain('sort:RANK');
    expect(clicks.some((click) => click.startsWith('tag:'))).toBe(false);
    expect(restoredOwn).toEqual([]);
  });

  it('stops when the toolbar leaves the page in the middle', async () => {
    const memory = await memoryOf({ grid: EVERYTHING });
    const { toolbar, clicks } = mount('grid');
    const removeAfterSort: FrameWait = (look) => {
      const found = look() ?? null;
      toolbar.remove();
      return Promise.resolve(found);
    };
    restoreOf(memory, { wait: removeAfterSort }).sync();
    await settle();
    expect(clicks.some((click) => click.startsWith('tag:'))).toBe(false);
    expect(restoredOwn).toEqual([]);
  });

  it('logs a failure of the own controls and does not throw', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const memory = await memoryOf({ grid: { direction: 'ASC' } });
    mount('grid');
    restoreOf(memory, {
      restoreOwn: () => {
        throw new Error('broken');
      },
    }).sync();
    await settle();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
