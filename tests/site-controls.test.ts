import { afterEach, describe, expect, it } from 'vitest';

import {
  FILTER_BODY,
  applyFilters,
  chooseSort,
  chooseTab,
  directionButtonOf,
  filterTriggerOf,
  flipDirection,
  isResetClick,
  readDirection,
  readDropdown,
  readTab,
  sortTriggerOf,
} from '../utils/sort/site-controls';
import type { FrameWait } from '../utils/shared/frame-wait';
import { mountSiteToolbar, type FixtureKind, type SiteToolbar } from './helpers/site-toolbar';

const KINDS: readonly FixtureKind[] = ['grid', 'deck', 'window'];

const wait: FrameWait = (look) => Promise.resolve(look() ?? null);
const never: FrameWait = () => Promise.resolve(null);

let mounted: SiteToolbar | null = null;

const mount = (kind: FixtureKind, overrides: Parameters<typeof mountSiteToolbar>[1] = {}): SiteToolbar => {
  mounted?.dispose();
  mounted = mountSiteToolbar(kind, overrides);
  return mounted;
};

afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.body.innerHTML = '';
});

describe('finding the controls of a toolbar', () => {
  it.each(KINDS)('finds the sort trigger, the filter trigger and the direction button in the %s toolbar', (kind) => {
    const { toolbar } = mount(kind);
    expect(sortTriggerOf(toolbar)?.textContent).toContain('По CREATED_AT');
    expect(filterTriggerOf(toolbar)?.textContent).toBe('Фильтр');
    expect(directionButtonOf(toolbar)?.getAttribute('data-fixture')).toBe('direction');
  });

  it('finds the sort trigger by the short label a phone shows', () => {
    const { toolbar } = mount('window');
    const label = sortTriggerOf(toolbar)?.querySelector('span');
    if (label) label.textContent = 'Сортировка';
    expect(sortTriggerOf(toolbar)).not.toBeNull();
  });

  it('finds nothing in a toolbar without them', () => {
    document.body.innerHTML = '<div class="user-card__filters"><div class="v-popper"><button>Что-то</button></div></div>';
    const toolbar = document.querySelector('.user-card__filters') as Element;
    expect([sortTriggerOf(toolbar), filterTriggerOf(toolbar), directionButtonOf(toolbar)]).toEqual([null, null, null]);
  });

  it('does not take our own control for the direction button', () => {
    const { toolbar } = mount('grid');
    toolbar.insertAdjacentHTML('beforeend', '<div class="senkutools-price-filter"><button id="own"></button></div>');
    expect(directionButtonOf(toolbar)?.getAttribute('data-fixture')).toBe('direction');
  });
});

describe('reading the direction and the tab', () => {
  it.each(KINDS)('reads descending by default and ascending after the site flips it in the %s toolbar', (kind) => {
    const { toolbar } = mount(kind);
    expect(readDirection(toolbar)).toBe('DESC');
    directionButtonOf(toolbar)?.click();
    expect(readDirection(toolbar)).toBe('ASC');
  });

  it('reads the active tab of the inventory and nothing for the other toolbars', () => {
    expect(readTab(mount('grid').toolbar)).toBe('cards');
    expect(readTab(mount('grid', { tab: 'Осколки' }).toolbar)).toBe('shards');
    expect(readTab(mount('deck').toolbar)).toBeNull();
  });

  it('reads the shards tab after the site switches to it', () => {
    const { toolbar } = mount('grid');
    chooseTab(toolbar, 'shards');
    expect(readTab(toolbar)).toBe('shards');
  });

  it('reads no tab when the site renames the tabs', () => {
    const { toolbar } = mount('grid');
    document.querySelectorAll('.tabs-tab').forEach((tab) => (tab.textContent = 'Другое'));
    expect(readTab(toolbar)).toBeNull();
  });
});

describe('reading the filter dropdown', () => {
  const open = (toolbar: Element): Element => {
    filterTriggerOf(toolbar)?.click();
    const body = document.querySelector(FILTER_BODY);
    if (!body) throw new Error('no dropdown');
    return body;
  };

  it('reads an untouched dropdown as empty with the first eight colors shown', () => {
    const state = readDropdown(open(mount('grid').toolbar));
    expect(state).toMatchObject({ ranks: [], colors: [], isAnimated: false, isExplicit: false });
    expect(state.shownColors).toHaveLength(8);
  });

  it('reads the ranks, the colors and both switches that are on', () => {
    const { toolbar } = mount('deck', { ranks: new Set(['S', 'A']), colors: new Set(['Белый']), isAnimated: true, isExplicit: true });
    expect(readDropdown(open(toolbar))).toMatchObject({ ranks: ['S', 'A'], colors: ['Белый'], isAnimated: true, isExplicit: true });
  });

  it('reads a switch that is off as off even when the other is on', () => {
    const { toolbar } = mount('window', { isExplicit: true });
    expect(readDropdown(open(toolbar))).toMatchObject({ isAnimated: false, isExplicit: true });
  });

  it('reads no color that the collapsed list does not draw', () => {
    const { toolbar } = mount('grid', { colors: new Set(['Зелёный']) });
    const state = readDropdown(open(toolbar));
    expect(state.colors).toEqual([]);
    expect(state.shownColors).not.toContain('Зелёный');
  });

  it('tells the reset button from the close button and from a tag', () => {
    const { toolbar } = mount('grid');
    open(toolbar);
    expect(isResetClick(document.querySelector('[data-fixture="reset"]') as Element)).toBe(true);
    expect(isResetClick(document.querySelector('[data-fixture="close"]') as Element)).toBe(false);
    expect(isResetClick(document.querySelector('.dropdown-filter__tags button') as Element)).toBe(false);
  });
});

describe('driving the sort, the direction and the tab', () => {
  it.each(KINDS)('picks a sort field through the menu in the %s toolbar and the menu closes', async (kind) => {
    const site = mount(kind);
    expect(await chooseSort(document, site.toolbar, 'RANK', wait)).toBe(true);
    expect(site.state.sort).toBe('RANK');
    expect(document.getElementById('cards-browse-order')).toBeNull();
  });

  it('does not pick a field the menu does not offer', async () => {
    const site = mount('grid');
    expect(await chooseSort(document, site.toolbar, 'UNKNOWN_FIELD', wait)).toBe(false);
    expect(site.state.sort).toBe('CREATED_AT');
  });

  it('does not wait for a menu that never appears', async () => {
    const site = mount('grid');
    expect(await chooseSort(document, site.toolbar, 'RANK', never)).toBe(false);
  });

  it('does nothing without a sort trigger', async () => {
    document.body.innerHTML = '<div class="user-card__filters"></div>';
    expect(await chooseSort(document, document.querySelector('.user-card__filters') as Element, 'RANK', wait)).toBe(false);
  });

  it('flips the direction once and tells whether there was a button', () => {
    const site = mount('window');
    expect(flipDirection(site.toolbar)).toBe(true);
    expect(site.state.direction).toBe('ASC');
    document.body.innerHTML = '<div class="user-card__filters"></div>';
    expect(flipDirection(document.querySelector('.user-card__filters') as Element)).toBe(false);
  });

  it('switches the inventory to a tab and refuses a toolbar without tabs', () => {
    const site = mount('grid');
    expect(chooseTab(site.toolbar, 'shards')).toBe(true);
    expect(site.state.tab).toBe('Осколки');
    expect(chooseTab(mount('deck').toolbar, 'shards')).toBe(false);
  });
});

describe('driving the filter dropdown', () => {
  const wanted = { ranks: [] as string[], colors: [] as string[], isAnimated: false, isExplicit: false };

  it('ticks the wanted ranks, colors and switches and closes the dropdown', async () => {
    const site = mount('grid');
    const done = await applyFilters(document, site.toolbar, { ranks: ['S', 'A'], colors: ['Белый'], isAnimated: true, isExplicit: true }, wait);
    expect(done).toBe(true);
    expect([...site.state.ranks]).toEqual(['S', 'A']);
    expect([...site.state.colors]).toEqual(['Белый']);
    expect([site.state.isAnimated, site.state.isExplicit]).toEqual([true, true]);
    expect(document.querySelector(FILTER_BODY)).toBeNull();
  });

  it.each(KINDS)('does the same in the %s toolbar', async (kind) => {
    const site = mount(kind);
    await applyFilters(document, site.toolbar, { ...wanted, ranks: ['F'] }, wait);
    expect([...site.state.ranks]).toEqual(['F']);
  });

  it('expands the color list to reach a color that the collapsed list does not show', async () => {
    const site = mount('grid');
    await applyFilters(document, site.toolbar, { ...wanted, colors: ['Белый', 'Зелёный'] }, wait);
    expect([...site.state.colors]).toEqual(['Белый', 'Зелёный']);
    expect(site.state.isColorsExpanded).toBe(true);
  });

  it('does not expand the color list when every wanted color is already shown', async () => {
    const site = mount('grid');
    await applyFilters(document, site.toolbar, { ...wanted, colors: ['Серый'] }, wait);
    expect(site.state.isColorsExpanded).toBe(false);
  });

  it('skips a color the site no longer offers and still ticks the others', async () => {
    const site = mount('grid');
    await applyFilters(document, site.toolbar, { ...wanted, colors: ['Несуществующий', 'Белый'], ranks: ['Z', 'S'] }, wait);
    expect([...site.state.colors]).toEqual(['Белый']);
    expect([...site.state.ranks]).toEqual(['S']);
  });

  it('does not click what is already on', async () => {
    const site = mount('grid', { ranks: new Set(['S']), isAnimated: true });
    await applyFilters(document, site.toolbar, { ranks: ['S'], colors: [], isAnimated: true, isExplicit: false }, wait);
    expect(site.clicks).toEqual([]);
  });

  it('ticks a switch only for the filters that are wanted', async () => {
    const site = mount('deck');
    await applyFilters(document, site.toolbar, { ...wanted, isExplicit: true }, wait);
    expect([site.state.isAnimated, site.state.isExplicit]).toEqual([false, true]);
  });

  it('reports a dropdown that never opens and a toolbar without a filter trigger', async () => {
    const site = mount('grid');
    expect(await applyFilters(document, site.toolbar, wanted, never)).toBe(false);
    document.body.innerHTML = '<div class="user-card__filters"></div>';
    expect(await applyFilters(document, document.querySelector('.user-card__filters') as Element, wanted, wait)).toBe(false);
  });
});
