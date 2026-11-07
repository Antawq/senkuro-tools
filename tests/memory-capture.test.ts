import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MEMORY_PLACES, MEMORY_VERSION, createFilterMemory, type FilterMemory, type MemoryPlace, type PlaceMemory } from '../utils/shared/filter-memory';
import { createMemoryCapture, type MemoryCapture } from '../utils/sort/memory-capture';
import { directionButtonOf, filterTriggerOf, sortTriggerOf } from '../utils/sort/site-controls';
import { mountSiteToolbar, type FixtureKind, type SiteToolbar } from './helpers/site-toolbar';

let site: SiteToolbar | null = null;
let memory: FilterMemory;
let capture: MemoryCapture;
let frames: (() => void)[] = [];

const trusted = (target: Element): void => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
};

const flush = (): void => frames.splice(0).forEach((run) => run());

const mount = (kind: FixtureKind, overrides: Parameters<typeof mountSiteToolbar>[1] = {}): SiteToolbar => {
  site?.dispose();
  site = mountSiteToolbar(kind, overrides);
  return site;
};

const placeOf = (place: MemoryPlace): PlaceMemory | null => memory.get(place);

beforeEach(async () => {
  frames = [];
  memory = createFilterMemory({ read: () => Promise.resolve({ version: MEMORY_VERSION, places: {} }), write: () => Promise.resolve() });
  await memory.load();
  capture = createMemoryCapture(document, memory, { nextFrame: (run) => void frames.push(run) });
  document.addEventListener('click', capture.handleClick, true);
});

afterEach(() => {
  document.removeEventListener('click', capture.handleClick, true);
  site?.dispose();
  site = null;
  document.body.innerHTML = '';
});

const pickSort = (toolbar: Element, field: string): void => {
  trusted(sortTriggerOf(toolbar) as Element);
  trusted(document.querySelector(`#cards-browse-order input[value="${field}"]`) as Element);
};

const openFilters = (toolbar: Element): void => trusted(filterTriggerOf(toolbar) as Element);

const tagButton = (label: string): Element =>
  [...document.querySelectorAll('.dropdown-filter__tags button')].find((button) => button.textContent === label) as Element;

describe('what the capture remembers from a sort choice', () => {
  it.each([
    ['grid', 'grid'],
    ['deck', 'deck'],
    ['window', 'trade'],
  ] as const)('remembers the sort field picked in the %s toolbar for the place %s, read a frame later', (kind, place) => {
    const { toolbar } = mount(kind);
    pickSort(toolbar, 'RANK');
    expect(placeOf(place)).toBeNull();
    flush();
    expect(placeOf(place)?.sort).toBe('RANK');
  });

  it('remembers the price sort of our own menu item as the sort', () => {
    const { toolbar } = mount('grid');
    trusted(sortTriggerOf(toolbar) as Element);
    document
      .querySelector('#cards-browse-order .dropdown-menu')
      ?.insertAdjacentHTML('beforeend', '<label class="radio--list" data-senkutools-sort-item=""><input type="radio" value="price"><span>Цене</span></label>');
    trusted(document.querySelector('#cards-browse-order input[value="price"]') as Element);
    flush();
    expect(placeOf('grid')?.sort).toBe('price');
  });

  it('does not touch the other fields of the place', () => {
    const { toolbar } = mount('grid');
    memory.update('grid', { ranks: ['S'] });
    pickSort(toolbar, 'QUANTITY');
    flush();
    expect(placeOf('grid')).toMatchObject({ sort: 'QUANTITY', ranks: ['S'] });
  });

  it('ignores a sort menu item with no value or when no toolbar trigger is marked open', () => {
    const { toolbar } = mount('grid');
    trusted(sortTriggerOf(toolbar) as Element);
    document.querySelector('#cards-browse-order .dropdown-menu')?.insertAdjacentHTML('beforeend', '<label class="radio--list"><span>Пусто</span></label>');
    trusted(document.querySelector('#cards-browse-order .radio--list:last-child') as Element);
    expect(frames).toHaveLength(0);
    sortTriggerOf(toolbar)?.removeAttribute('data-popper-shown');
    trusted(document.querySelector('#cards-browse-order input[value="RANK"]') as Element);
    expect(frames).toHaveLength(0);
  });
});

describe('what the capture remembers from the direction button and the tab', () => {
  it('reads the direction after the site flipped it', () => {
    const { toolbar } = mount('deck');
    trusted(directionButtonOf(toolbar) as Element);
    flush();
    expect(placeOf('deck')?.direction).toBe('ASC');
    trusted(directionButtonOf(toolbar) as Element);
    flush();
    expect(placeOf('deck')?.direction).toBe('DESC');
  });

  it('reads the tab of the inventory after the click', () => {
    mount('grid');
    trusted([...document.querySelectorAll('.tabs-tab')].find((tab) => tab.textContent === 'Осколки') as Element);
    flush();
    expect(placeOf('grid')?.tab).toBe('shards');
    trusted([...document.querySelectorAll('.tabs-tab')].find((tab) => tab.textContent === 'Карты') as Element);
    flush();
    expect(placeOf('grid')?.tab).toBe('cards');
  });

  it('ignores a tab that does not belong to the inventory toolbar', () => {
    document.body.innerHTML = '<section><div class="tabs"><button class="tabs-tab tabs-tab--active">Карты</button></div></section>';
    trusted(document.querySelector('.tabs-tab') as Element);
    document.body.innerHTML = '<div><button class="tabs-tab tabs-tab--active">Карты</button></div>';
    trusted(document.querySelector('.tabs-tab') as Element);
    flush();
    expect(placeOf('grid')).toBeNull();
  });
});

describe('what the capture remembers from the filter dropdown', () => {
  it('remembers ranks, colors and switches as they are after the click', () => {
    const { toolbar } = mount('grid');
    openFilters(toolbar);
    trusted(tagButton('S'));
    trusted(tagButton('Белый'));
    trusted(document.querySelector('.switch input') as Element);
    flush();
    expect(placeOf('grid')).toMatchObject({ ranks: ['S'], colors: ['Белый'], isAnimated: true, isExplicit: false });
  });

  it('remembers a rank taken off again', () => {
    const { toolbar } = mount('deck');
    openFilters(toolbar);
    trusted(tagButton('S'));
    flush();
    trusted(tagButton('S'));
    flush();
    expect(placeOf('deck')?.ranks).toEqual([]);
  });

  it('keeps a remembered color that the collapsed list does not draw', () => {
    const { toolbar } = mount('grid', { colors: new Set(['Зелёный']) });
    memory.update('grid', { colors: ['Зелёный'] });
    openFilters(toolbar);
    trusted(tagButton('Белый'));
    flush();
    expect(placeOf('grid')?.colors).toEqual(['Белый', 'Зелёный']);
  });

  it('forgets every color, rank and switch on the inventory reset button, and keeps the switches in a window or deck', () => {
    const { toolbar: gridToolbar } = mount('grid', { ranks: new Set(['S']), colors: new Set(['Зелёный', 'Белый']), isAnimated: true, isExplicit: true });
    memory.update('grid', { ranks: ['S'], colors: ['Зелёный', 'Белый'], isAnimated: true, isExplicit: true });
    openFilters(gridToolbar);
    trusted(document.querySelector('[data-fixture="reset"]') as Element);
    flush();
    expect(placeOf('grid')).toMatchObject({ ranks: [], colors: [], isAnimated: false, isExplicit: false });

    const { toolbar: windowToolbar } = mount('window', { ranks: new Set(['S']), colors: new Set(['Зелёный']), isExplicit: true });
    memory.update('trade', { ranks: ['S'], colors: ['Зелёный'], isExplicit: true });
    openFilters(windowToolbar);
    trusted(document.querySelector('[data-fixture="reset"]') as Element);
    flush();
    expect(placeOf('trade')).toMatchObject({ ranks: [], colors: [], isExplicit: true });
  });

  it('attributes a modal filter click to the window even when the background inventory trigger carries aria-describedby', () => {
    const { toolbar: windowToolbar } = mount('window');
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<section><div class="user-card__filters"><div class="v-popper"><button aria-describedby="trade-filter">Фильтр</button></div></div></section>'
    );
    openFilters(windowToolbar);
    trusted(tagButton('A'));
    flush();
    expect(placeOf('trade')?.ranks).toEqual(['A']);
    expect(placeOf('grid')).toBeNull();
  });

  it('remembers the dropdown of a window as the trade place', () => {
    const { toolbar } = mount('window');
    openFilters(toolbar);
    trusted(tagButton('A'));
    flush();
    expect(placeOf('trade')?.ranks).toEqual(['A']);
    expect(placeOf('grid')).toBeNull();
  });

  it('does not write anything for the close button', () => {
    const { toolbar } = mount('grid');
    openFilters(toolbar);
    trusted(document.querySelector('[data-fixture="close"]') as Element);
    flush();
    expect(placeOf('grid')).toBeNull();
  });

  it('reads nothing when the dropdown closed before the frame', () => {
    const { toolbar } = mount('grid');
    openFilters(toolbar);
    trusted(tagButton('S'));
    document.getElementById('trade-filter')?.remove();
    flush();
    expect(placeOf('grid')).toBeNull();
  });

  it('ignores a click inside a dropdown that no toolbar opened', () => {
    mount('grid');
    document.body.insertAdjacentHTML('beforeend', '<div id="trade-filter"><div class="dropdown-filter__body"><button>S</button></div></div>');
    trusted(document.querySelector('#trade-filter button') as Element);
    flush();
    expect(placeOf('grid')).toBeNull();
  });
});

describe('which events the capture listens to', () => {
  it('ignores a click the page did not get from the user', () => {
    const { toolbar } = mount('grid');
    sortTriggerOf(toolbar)?.click();
    (document.querySelector('#cards-browse-order input[value="RANK"]') as HTMLElement).click();
    directionButtonOf(toolbar)?.click();
    flush();
    expect(placeOf('grid')).toBeNull();
    expect(capture.hasTouched(toolbar)).toBe(false);
  });

  it('marks the toolbar touched by any trusted click inside it, or when told to touch it', () => {
    const { toolbar } = mount('grid');
    expect(capture.hasTouched(toolbar)).toBe(false);
    trusted(sortTriggerOf(toolbar) as Element);
    expect(capture.hasTouched(toolbar)).toBe(true);
    const { toolbar: nextToolbar } = mount('deck');
    expect(capture.hasTouched(nextToolbar)).toBe(false);
    capture.touch(nextToolbar);
    expect(capture.hasTouched(nextToolbar)).toBe(true);
  });

  it('marks the toolbar touched also when the place has no memory key', () => {
    document.body.innerHTML =
      '<div class="modal-content modal-content--trade"><header class="modal-trade__header"><div>Выбор карт из общего каталога</div></header><div class="modal-trade__header-form"><button type="button" class="button button--secondary"><span>Сначала</span></button></div></div>';
    const toolbar = document.querySelector('.modal-trade__header-form') as Element;
    trusted(toolbar.querySelector('button') as Element);
    expect(capture.hasTouched(toolbar)).toBe(true);
    expect(frames).toHaveLength(0);
    expect(MEMORY_PLACES.map(placeOf)).toEqual(MEMORY_PLACES.map(() => null));
  });

  it('writes nothing before the memory is loaded', async () => {
    const unloaded = createFilterMemory({ read: () => Promise.resolve(undefined), write: () => Promise.resolve() });
    document.removeEventListener('click', capture.handleClick, true);
    capture = createMemoryCapture(document, unloaded, { nextFrame: (run) => void frames.push(run) });
    document.addEventListener('click', capture.handleClick, true);
    const { toolbar } = mount('grid');
    pickSort(toolbar, 'RANK');
    flush();
    await unloaded.load();
    expect(unloaded.get('grid')).toBeNull();
  });

  it('ignores a click on something that is not an element', () => {
    mount('grid');
    const event = new Event('click');
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.dispatchEvent(event);
    flush();
    expect(placeOf('grid')).toBeNull();
  });
});
