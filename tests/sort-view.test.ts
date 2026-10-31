import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../utils/shared/database';
import type { ListScope } from '../utils/shared/list-scope';
import { priceRowsSignal, priceStateSignal, type PriceOrder, type PriceStateName, type ViewSort } from '../utils/shared/price-signal';
import type { PriceRange } from '../utils/sort/price-range';
import { createPriceSort, hasSortMutation, type PriceSort, type SortHost } from '../utils/sort/sort-view';
import { installIntersectionObservers } from './helpers/intersection-observer';

const database: Database = {
  cheap: { price: 1.5, name: 'Cheap', rank: 'F' },
  mid: { price: 20, name: 'Mid', rank: 'D' },
  dear: { price: 300, name: 'Dear', rank: 'S' },
  twin: { price: 20.004, name: 'Twin', rank: 'D' },
};

const SORT_ITEMS = ['Рангу', 'Количеству', 'Популярности', 'Персонажу', 'Произведению', 'Дате получения', 'Дате обновления'];

const radio = (text: string, isChecked: boolean) =>
  `<label class="radio radio-size--md radio--list"><input type="radio" value="${text}"${isChecked ? ' checked=""' : ''}><div class="radio__label"><!----><span>${text}</span><!----></div></label>`;

const menuHtml = (checkedIndex = 5) =>
  `<div id="cards-browse-order" class="v-popper__popper"><div class="dropdown-menu dropdown-menu--sm"><div class="dropdown-menu__caption"> Сортировать по </div>${SORT_ITEMS.map((text, index) => radio(text, index === checkedIndex)).join('')}</div></div>`;

const cardHtml = (slug: string, index: number) =>
  `<div class="card-collect-preview user-card" data-index="${index}"><a href="/cards/${slug}" class="card-collect"></a><div class="card-collect-preview__back"><a href="/cards/${slug}" class="card-collect card-collect--flip"></a></div></div>`;

interface Page {
  slugs?: string[];
  hasMoreCards?: boolean;
  isAscending?: boolean;
  hasMenu?: boolean;
  hasFilters?: boolean;
}

const render = ({ slugs = ['mid', 'dear', 'cheap'], hasMoreCards = false, isAscending = false, hasMenu = false, hasFilters = true }: Page = {}) => {
  document.body.innerHTML = `${
    hasFilters
      ? `<div class="back-actions"><div class="user-card__filters"><button class="button button--icon${isAscending ? ' cards-cnt__nav-filter--asc' : ''}" id="direction"></button><div class="v-popper"><button id="sort-trigger" class="button"${hasMenu ? ' aria-describedby="cards-browse-order" data-popper-shown=""' : ''}><span>По дате получения</span></button></div><div class="v-popper"><button id="filter-trigger" class="button"><span>Фильтр</span></button></div></div></div>`
      : ''
  }<div class="user-cards-grid">${slugs.map(cardHtml).join('')}${hasMoreCards ? '<div></div>' : ''}</div>${hasMenu ? menuHtml() : ''}`;
};

const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.user-cards-grid > .user-card')];
const placeOf = (card: HTMLElement | undefined): string | undefined => card?.style.order;
const slugsByPlace = (): string[] =>
  cards()
    .map((card) => ({ slug: card.querySelector('a')?.getAttribute('href')?.split('/').pop() ?? '', place: Number(card.style.order) }))
    .sort((a, b) => a.place - b.place)
    .map((entry) => entry.slug);
const grid = () => document.querySelector<HTMLElement>('.user-cards-grid');
const filters = () => document.querySelector<HTMLElement>('.user-card__filters');
const label = () => document.querySelector('#sort-trigger span')?.textContent;
const own = () => document.querySelector<HTMLInputElement>('[data-senkutools-sort-item] input');
const settings = { commission: false };
const checkedItems = (): string[] =>
  [...document.querySelectorAll<HTMLInputElement>('#cards-browse-order input')]
    .filter((input) => input.checked)
    .map((input) => input.closest('label')?.textContent?.trim() ?? '');

const press = (sort: PriceSort, element: Element | null): void => {
  document.addEventListener('click', sort.handleClick, true);
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.removeEventListener('click', sort.handleClick, true);
};

const setup = (scope: ListScope = 'grid') => {
  const views: boolean[] = [];
  const sorts: ViewSort[] = [];
  const orders: PriceOrder[] = [];
  const timers: (() => void)[] = [];
  const host: SortHost = {
    setView: (isOn, sort) => {
      views.push(isOn);
      sorts.push(sort);
    },
    sendOrder: (order) => void orders.push(order),
    runAfter: (run) => void timers.push(run),
    schedule: vi.fn<() => void>(),
  };
  const sort = createPriceSort(document, scope, host);
  const choose = () => press(sort, own());
  const state = (name: PriceStateName, loaded = 0, total: number | null = null, from: ListScope = scope) =>
    sort.handleState(new CustomEvent(priceStateSignal.name, { detail: priceStateSignal.encode({ scope: from, name, loaded, total }) }));
  const rows = (viewId: number, slugs: (string | null)[], from: ListScope = scope) =>
    sort.handleRows(new CustomEvent(priceRowsSignal.name, { detail: priceRowsSignal.encode({ scope: from, viewId, slugs }) }));
  return { sort, host, views, sorts, orders, timers, choose, state, rows };
};

const enablePriceMode = () => filters()?.setAttribute('data-senkutools-sort', 'price');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the menu', () => {
  it('gets a last item for the price, built like the site items and unchecked', () => {
    render({ hasMenu: true });
    const { sort } = setup();
    sort.sync(database, settings);
    const menuItems = [...document.querySelectorAll('#cards-browse-order label.radio--list')];
    expect(menuItems).toHaveLength(SORT_ITEMS.length + 1);
    const added = menuItems.at(-1) as HTMLElement;
    expect(added.className).toBe(menuItems[0]?.className);
    expect(added.textContent?.trim()).toBe('Цене');
    expect(own()?.value).toBe('price');
    expect(own()?.checked).toBe(false);
  });

  it('leaves the item the site checked alone while the mode is off', () => {
    render({ hasMenu: true });
    const { sort } = setup();
    sort.sync(database, settings);
    expect(checkedItems()).toEqual(['Дате получения']);
  });

  it('is decorated once, however often it is looked at', () => {
    render({ hasMenu: true });
    const { sort } = setup();
    sort.sync(database, settings);
    sort.sync(database, settings);
    expect(document.querySelectorAll('[data-senkutools-sort-item]')).toHaveLength(1);
  });

  it('is left alone when it is not the cards page, or a window is open over it, or the menu is not the sort menu of this page', () => {
    render({ hasMenu: true, hasFilters: false });
    const first = setup();
    first.sort.sync(database, settings);
    expect(own()).toBeNull();
    render({ hasMenu: true });
    document.body.insertAdjacentHTML('beforeend', '<div class="modal-content modal-content--trade"></div>');
    first.sort.sync(database, settings);
    expect(own()).toBeNull();
    render();
    document.body.insertAdjacentHTML('beforeend', '<div class="dropdown-menu dropdown-menu--sm">' + radio('Рангу', true) + '</div>');
    first.sort.sync(database, settings);
    expect(own()).toBeNull();
  });

  it('is left alone when the site changes it so that there is nothing to copy', () => {
    render();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="cards-browse-order"><div class="dropdown-menu dropdown-menu--sm"><div>Сортировать по</div></div></div>'
    );
    const { sort } = setup();
    expect(() => sort.sync(database, settings)).not.toThrow();
    expect(own()).toBeNull();
    document.querySelector('#cards-browse-order .dropdown-menu')?.insertAdjacentHTML('beforeend', '<label class="radio--list"></label>');
    expect(() => sort.sync(database, settings)).not.toThrow();
    expect(own()).toBeNull();
  });
});

describe('choosing the price', () => {
  it('turns it on, closes the menu through its button, starts the view, labels the button and shows the item as the checked one', () => {
    render({ hasMenu: true });
    const { sort, host, choose, views, sorts } = setup();
    sort.sync(database, settings);
    const closed = vi.fn();
    document.querySelector('#sort-trigger')?.addEventListener('click', closed);
    choose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(filters()?.getAttribute('data-senkutools-sort')).toBe('price');
    expect(views).toEqual([true]);
    expect(sorts).toEqual(['price']);
    expect(host.schedule).toHaveBeenCalled();
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    expect(own()?.checked).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('#cards-browse-order input')].filter((input) => input.checked)).toHaveLength(1);
  });

  it('shows it as the checked item when the menu is opened again later', () => {
    render();
    const { sort } = setup();
    enablePriceMode();
    document.body.insertAdjacentHTML('beforeend', menuHtml());
    sort.sync(database, settings);
    expect(own()?.checked).toBe(true);
    expect(document.querySelectorAll<HTMLInputElement>('#cards-browse-order input:checked')).toHaveLength(1);
  });

  it('chooses once when the label is clicked, although the browser follows that with a click on the field', () => {
    render({ hasMenu: true });
    const { sort, views } = setup();
    sort.sync(database, settings);
    const closed = vi.fn();
    document.querySelector('#sort-trigger')?.addEventListener('click', closed);
    press(sort, document.querySelector('[data-senkutools-sort-item]'));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(filters()?.getAttribute('data-senkutools-sort')).toBe('price');
    expect(views).toEqual([true]);
  });

  it('does not start a second view when the price is chosen again while the first one runs', () => {
    render({ hasMenu: true });
    const { sort, choose, views } = setup();
    sort.sync(database, settings);
    choose();
    choose();
    expect(views).toEqual([true]);
  });

  it('turns off when any item of the site is chosen, ends the view, and gives the button its own label back', () => {
    render({ hasMenu: true });
    const { sort, host, views } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    const before = vi.mocked(host.schedule).mock.calls.length;
    press(sort, document.querySelector('#cards-browse-order label.radio--list input'));
    expect(filters()?.getAttribute('data-senkutools-sort')).toBeNull();
    expect(views).toEqual([true, false]);
    expect(vi.mocked(host.schedule).mock.calls.length).toBeGreaterThan(before);
    sort.sync(database, settings);
    expect(label()).toBe('По дате получения');
    expect(filters()?.hasAttribute('data-senkutools-sort-label')).toBe(false);
    expect(grid()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
  });

  it('ends the view once when the mode is gone from the page under it, for example after a move to another page', () => {
    render({ hasMenu: true });
    const { sort, views } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    filters()?.removeAttribute('data-senkutools-sort');
    sort.sync(database, settings);
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
  });

  it('ends the view when the cards page itself is gone, so a crawl does not run on in another page', () => {
    render({ hasMenu: true });
    const { sort, views } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    render({ hasFilters: false });
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
  });

  it('leaves the button text to the site when the site already changed it', () => {
    render({ hasMenu: true });
    const { sort } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    document.querySelector('#sort-trigger span')!.textContent = 'По рангу';
    filters()?.removeAttribute('data-senkutools-sort');
    sort.sync(database, settings);
    expect(label()).toBe('По рангу');
  });

  it('does nothing when an item of the site is chosen and the price was not on', () => {
    render({ hasMenu: true });
    const { sort, host, views } = setup();
    sort.sync(database, settings);
    press(sort, document.querySelector('#cards-browse-order label.radio--list input'));
    expect(host.schedule).not.toHaveBeenCalled();
    expect(views).toEqual([]);
  });

  it('finds the sort button by its text, not by its place among the buttons', () => {
    render({ hasMenu: true });
    const filterPopper = document.querySelector('#filter-trigger')!.parentElement!;
    document.querySelector('.user-card__filters')!.insertBefore(filterPopper, document.querySelector('#sort-trigger')!.parentElement);
    const { sort } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    expect(document.querySelector('#filter-trigger span')?.textContent).toBe('Фильтр');
  });

  it('does nothing for clicks elsewhere', () => {
    render({ hasMenu: true });
    const { sort, host } = setup();
    sort.sync(database, settings);
    sort.handleClick(new MouseEvent('click'));
    press(sort, document.querySelector('#filter-trigger'));
    press(sort, document.querySelector('#cards-browse-order .dropdown-menu__caption'));
    press(sort, document.querySelector('.user-card'));
    expect(host.schedule).not.toHaveBeenCalled();
  });

  it('does nothing when the cards page is not there', () => {
    render({ hasFilters: false });
    const { sort, views } = setup();
    sort.sync(database, settings);
    expect(views).toEqual([]);
    expect(cards().map(placeOf)).toEqual(['', '', '']);
  });

  it('labels the button even before the cards are there', () => {
    render();
    document.querySelector('.user-cards-grid')?.remove();
    const { sort } = setup();
    enablePriceMode();
    expect(() => sort.sync(database, settings)).not.toThrow();
    expect(label()).toBe('По цене');
  });
});

describe('the view while the list is loading', () => {
  it('dims the grid, leaves the cards in the order of the site and labels the button', () => {
    render({ hasMoreCards: true });
    const { sort } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
    expect(cards().map(placeOf)).toEqual(['', '', '']);
    expect(label()).toBe('По цене');
  });

  it('says how far the list is in the label, and gives the label of the site back afterwards', () => {
    render({ hasMenu: true });
    const { sort, state } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    state('loading', 40, 100);
    sort.sync(database, settings);
    expect(label()).toBe('По цене 40%');
    state('loading', 99, 100);
    sort.sync(database, settings);
    expect(label()).toBe('По цене 99%');
    state('loading', 100, 99);
    sort.sync(database, settings);
    expect(label()).toBe('По цене 100%');
    state('loading', 5, null);
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    filters()?.removeAttribute('data-senkutools-sort');
    sort.sync(database, settings);
    expect(label()).toBe('По дате получения');
  });

  it('asks for a redraw for every message of the page, so the grid is looked at again', () => {
    render();
    const { sort, host, state } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    const before = vi.mocked(host.schedule).mock.calls.length;
    state('loading', 1, 2);
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before + 1);
    state('ready', 1, 1);
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before + 2);
  });

  it('sends the order of the list once the rows are in: both directions, the most expensive first, what has no price last, equal prices in the order of the list', () => {
    render();
    const { sort, rows, orders } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    rows(1, ['mid', 'dear', 'cheap', 'twin', 'stranger', null]);
    expect(orders).toEqual([{ viewId: 1, revision: 1, descending: [1, 0, 3, 2, 4, 5], ascending: [2, 0, 3, 1, 4, 5] }]);
  });

  it('sends the order as soon as the database is there when the rows came before it', () => {
    render();
    const { sort, rows, orders } = setup();
    rows(1, ['mid', 'dear']);
    expect(orders).toHaveLength(0);
    enablePriceMode();
    sort.sync(database, settings);
    rows(1, ['mid', 'dear']);
    expect(orders).toEqual([{ viewId: 1, revision: 1, descending: [1, 0], ascending: [0, 1] }]);
  });

  it('prices cards the way their badges show, so equal-looking prices keep the order of the list', () => {
    render();
    const { sort, rows, orders } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    rows(1, ['twin', 'mid', 'dear']);
    expect(orders[0]?.descending).toEqual([2, 0, 1]);
    expect(orders[0]?.ascending).toEqual([0, 1, 2]);
  });

  it('orders a shard row by the price of its whole card, the price its badge shows, next to the card in the order of the list', () => {
    render();
    const { sort, rows, orders } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    rows(1, ['mid', 'dear', 'mid', 'cheap']);
    expect(orders.at(-1)?.descending).toEqual([1, 0, 2, 3]);
    expect(orders.at(-1)?.ascending).toEqual([3, 0, 2, 1]);
  });

  it('counts a price that is not a number as no price', () => {
    render();
    const { sort, rows, orders } = setup();
    enablePriceMode();
    sort.sync({ ...database, bad: { price: Number.NaN, name: 'x', rank: 'F' }, worse: { price: null as unknown as number, name: 'y', rank: 'F' } }, settings);
    rows(1, ['bad', 'cheap', 'worse', 'dear']);
    expect(orders[0]?.descending).toEqual([3, 1, 0, 2]);
  });
});

describe('the view once the list is sorted', () => {
  const ready = () => {
    render();
    const harness = setup();
    enablePriceMode();
    harness.sort.sync(database, settings);
    harness.rows(1, ['mid', 'dear', 'cheap']);
    harness.state('ready', 3, 3);
    harness.sort.sync(database, settings);
    return harness;
  };

  it('shows the grid as it is: the page draws the sorted list itself, so no order, no dimming', () => {
    ready();
    expect(grid()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
    expect(cards().map(placeOf)).toEqual(['', '', '']);
    expect(label()).toBe('По цене');
  });

  it('sends the order again, newer, when the commission changes, and not when nothing did', () => {
    const { sort, orders } = ready();
    sort.sync(database, settings);
    expect(orders).toHaveLength(1);
    const prices: Database = {
      mid: { price: 100.004, name: 'A', rank: 'F' },
      dear: { price: 100.006, name: 'B', rank: 'F' },
      cheap: { price: 1, name: 'C', rank: 'F' },
    };
    sort.sync(prices, { commission: false });
    expect(orders).toHaveLength(2);
    expect(orders[1]).toMatchObject({ viewId: 1, revision: 2, descending: [1, 0, 2] });
    sort.sync(prices, { commission: true });
    expect(orders).toHaveLength(3);
    expect(orders[2]).toMatchObject({ revision: 3, descending: [0, 1, 2] });
    sort.sync(prices, { commission: true });
    expect(orders).toHaveLength(3);
  });

  it('waits for the rows of the new list when the page starts over, and sends their order, not the old one', () => {
    const { sort, state, rows, orders } = ready();
    state('loading', 0, null);
    sort.sync(database, settings);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
    sort.sync(database, settings);
    expect(orders).toHaveLength(1);
    rows(2, ['cheap', 'dear']);
    expect(orders[1]).toEqual({ viewId: 2, revision: 1, descending: [1, 0], ascending: [0, 1] });
    state('ready', 2, 2);
    sort.sync(database, settings);
    expect(grid()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
  });

  it('sends no order for the rows of the list it left, even when the prices change while the new list loads', () => {
    const { sort, state, orders } = ready();
    state('loading', 0, null);
    sort.sync({ ...database, mid: { price: 999, name: 'Mid', rank: 'D' } }, settings);
    sort.sync(database, { commission: true });
    expect(orders).toHaveLength(1);
  });

  it('ignores rows that come when it is not waiting for them', () => {
    const { rows, orders } = ready();
    rows(5, ['mid']);
    expect(orders).toHaveLength(1);
  });
});

describe('the view that cannot run', () => {
  const fallBack = (name: PriceStateName) => {
    render({ hasMoreCards: true });
    const harness = setup();
    enablePriceMode();
    harness.sort.sync(database, settings);
    harness.state(name);
    harness.sort.sync(database, settings);
    return harness;
  };

  it('puts the cards that are there in order, says so, ends the view and does not ask again, when the page says it cannot', () => {
    for (const name of ['unavailable', 'failed'] as const) {
      const { sort, views } = fallBack(name);
      sort.sync(database, settings);
      expect(views).toEqual([true, false]);
      expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('partial');
      expect(slugsByPlace()).toEqual(['dear', 'mid', 'cheap']);
      expect(label()).toBe('По цене (часть)');
      expect(document.querySelector('#sort-trigger')?.getAttribute('title')).toBe('Отсортированы только загруженные карты');
    }
  });

  it('turns around with the direction button of the site', () => {
    render({ isAscending: true });
    const { sort, state } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    state('failed');
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['cheap', 'mid', 'dear']);
  });

  it('prices cards the way their badges show, with the commission taken when it is', () => {
    render({ slugs: ['a', 'b'] });
    const { sort, state } = setup();
    enablePriceMode();
    const prices: Database = { a: { price: 100.004, name: 'A', rank: 'F' }, b: { price: 100.006, name: 'B', rank: 'F' } };
    sort.sync(prices, { commission: false });
    state('failed');
    sort.sync(prices, { commission: false });
    expect(slugsByPlace()).toEqual(['b', 'a']);
    sort.sync(prices, { commission: true });
    expect(slugsByPlace()).toEqual(['a', 'b']);
  });

  it('puts cards the database does not know at the end, in the site order, and puts in order the cards that arrive later', () => {
    render({ slugs: ['stranger', 'cheap', 'unknown', 'dear'] });
    const { sort, state } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    state('failed');
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['dear', 'cheap', 'stranger', 'unknown']);
    document.querySelector('.user-cards-grid')?.insertAdjacentHTML('beforeend', cardHtml('mid', 4));
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['dear', 'mid', 'cheap', 'stranger', 'unknown']);
  });

  it('takes the order and the hint off when the mode ends', () => {
    const { sort } = fallBack('failed');
    filters()?.removeAttribute('data-senkutools-sort');
    sort.sync(database, settings);
    expect(cards().map(placeOf)).toEqual(['', '', '']);
    expect(document.querySelector('#sort-trigger')?.hasAttribute('title')).toBe(false);
    expect(grid()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
  });

  it('tries the view again when the price is chosen once more', () => {
    render({ hasMenu: true });
    const { sort, state, choose, views } = setup();
    sort.sync(database, settings);
    choose();
    state('failed');
    sort.sync(database, settings);
    choose();
    expect(views).toEqual([true, false, true]);
    sort.sync(database, settings);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });

  it('takes the order it put on the loaded cards off when the view is tried again', () => {
    render({ hasMenu: true });
    const { sort, state, choose } = setup();
    sort.sync(database, settings);
    choose();
    state('failed');
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['dear', 'mid', 'cheap']);
    choose();
    sort.sync(database, settings);
    expect(cards().map(placeOf)).toEqual(['', '', '']);
  });

  it('gives up waiting when nothing is heard for a long time, and waits on while the page keeps talking', () => {
    render({ hasMoreCards: true });
    const { sort, timers, state, views } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    expect(timers).toHaveLength(1);
    state('loading', 1, 10);
    timers.shift()?.();
    expect(timers).toHaveLength(1);
    expect(views).toEqual([true]);
    timers.shift()?.();
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('partial');
    expect(label()).toBe('По цене (часть)');
  });

  it('does not mind a late timer once the page has answered', () => {
    render();
    const { sort, timers, state, host, views } = setup();
    enablePriceMode();
    sort.sync(database, settings);
    state('ready', 1, 1);
    const before = vi.mocked(host.schedule).mock.calls.length;
    timers.shift()?.();
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before);
    expect(views).toEqual([true]);
  });
});

describe('what the page says', () => {
  it('is ignored when it is not a message of the view, or the price is not on', () => {
    render();
    const { sort, host, views, orders } = setup();
    sort.handleState(new CustomEvent(priceStateSignal.name, { detail: priceStateSignal.encode({ scope: 'grid', name: 'failed', loaded: 0, total: null }) }));
    sort.handleRows(new CustomEvent(priceRowsSignal.name, { detail: priceRowsSignal.encode({ scope: 'grid', viewId: 1, slugs: ['mid'] }) }));
    expect(host.schedule).not.toHaveBeenCalled();
    enablePriceMode();
    sort.sync(database, settings);
    const before = vi.mocked(host.schedule).mock.calls.length;
    sort.handleState(new CustomEvent(priceStateSignal.name, { detail: 'nonsense' }));
    sort.handleState(new CustomEvent(priceStateSignal.name));
    sort.handleRows(new CustomEvent(priceRowsSignal.name, { detail: 'nonsense' }));
    sort.handleRows(new CustomEvent(priceRowsSignal.name));
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before);
    expect(views).toEqual([true]);
    expect(orders).toEqual([]);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });
});

describe('hasSortMutation', () => {
  const record = (target: Node, added: Node[] = [], removed: Node[] = []): MutationRecord =>
    ({ target, addedNodes: added as unknown as NodeList, removedNodes: removed as unknown as NodeList }) as MutationRecord;

  it('notices changes in the grid, the bar, and the sort menu, and a menu that is added', () => {
    render({ hasMenu: true });
    expect(hasSortMutation([record(document.querySelector('.user-cards-grid')!)])).toBe(true);
    expect(hasSortMutation([record(document.querySelector('.user-card__filters button')!)])).toBe(true);
    expect(hasSortMutation([record(document.querySelector('#cards-browse-order .dropdown-menu')!)])).toBe(true);
    expect(hasSortMutation([record(document.querySelector('.user-card span, .radio__label span')!.firstChild ?? document.body)])).toBe(true);
    const popper = document.querySelector('#cards-browse-order')!;
    expect(hasSortMutation([record(document.body, [popper])])).toBe(true);
    const wrapper = document.createElement('div');
    wrapper.append(popper.cloneNode(true));
    expect(hasSortMutation([record(document.body, [wrapper])])).toBe(true);
  });

  it('does not notice the rest of the page', () => {
    render({ hasMenu: true });
    const other = document.createElement('p');
    document.body.append(other);
    expect(hasSortMutation([record(other, [document.createElement('span'), document.createTextNode('x')])])).toBe(false);
    expect(hasSortMutation([record(document.createTextNode('x'))])).toBe(false);
    expect(hasSortMutation([])).toBe(false);
  });
});

interface WindowPage {
  hint?: string;
  label?: string;
  isMenuOpen?: boolean;
  slugs?: string[];
}

const OPEN_MARKS = ' aria-describedby="cards-browse-order" data-popper-shown=""';

const windowHtml = ({
  hint = ' Выбери до 50 карт, которые готов отдать взамен',
  label = 'По дате получения',
  isMenuOpen = false,
  slugs = ['mid', 'dear'],
}: WindowPage = {}) => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header"><div class="modal-trade__header-headline"><h4 class="caption">Твои карточки</h4><div class="modal-trade__header-hint">${hint}</div></div></header>
    <div class="modal-trade__body scrollbar">
      <div class="modal-trade__header-form">
        <div class="v-popper"><button id="window-sort" class="button modal-trade__header-form__mob"${isMenuOpen ? OPEN_MARKS : ''}><svg></svg><span>${label}</span><svg></svg></button></div>
        <button id="window-direction" class="button"><svg></svg><span>Сначала</span></button>
        <div class="v-popper"><button class="button"><span>Фильтр</span></button></div>
      </div>
      <div class="modal-trade__body-result">${slugs.map((slug) => `<div class="card-collect-preview"><a href="/cards/${slug}" class="card-collect"></a></div>`).join('')}</div>
    </div>
  </div>`;

const deckHtml = (isMenuOpen = false) => `
  <div class="card-browse">
    <div class="card-browse__form"><div class="v-popper"><button id="deck-sort" class="button card-browse__form__mob"${isMenuOpen ? OPEN_MARKS : ''}><svg></svg><span>По дате получения</span><svg></svg></button></div></div>
    <div class="card-browse__cnt scrollbar"><div class="card-browse__cnt-result"><div class="card-collect-preview user-card-browse__card"><a href="/cards/mid" class="card-collect"></a></div></div></div>
  </div>`;

const catalogHtml = `<div class="catalog-cnt__nav"><div class="v-popper"><button${OPEN_MARKS}><span>По популярности</span></button></div></div>`;

const windowToolbar = () => document.querySelector<HTMLElement>('.modal-content--trade .modal-trade__header-form');
const windowLabel = () => document.querySelector('#window-sort span')?.textContent;
const windowResults = () => document.querySelector<HTMLElement>('.modal-trade__body-result');
const windowRowOrders = () => [...document.querySelectorAll<HTMLElement>('.modal-trade__body-result .card-collect-preview')].map((row) => row.style.order);
const deckToolbar = () => document.querySelector<HTMLElement>('.card-browse__form');
const setHint = (text: string) => {
  document.querySelector('.modal-trade__header-hint')!.textContent = text;
};

describe('the lists of a window and of the deck builder', () => {
  it('get the item in the sort menu of a window that lists cards and of the deck builder, from the sort of the pickers only', () => {
    document.body.innerHTML = windowHtml({ isMenuOpen: true }) + menuHtml();
    setup('grid').sort.sync(database, settings);
    expect(own()).toBeNull();
    const picker = setup('picker');
    picker.sort.sync(database, settings);
    expect(own()?.closest('label')?.textContent?.trim()).toBe('Цене');
    document.body.innerHTML = deckHtml(true) + menuHtml();
    picker.sort.sync(database, settings);
    expect(own()).not.toBeNull();
  });

  it('get no item on the catalog step of the offer window, on the catalog of all cards, or under another window', () => {
    const picker = setup('picker');
    const grid = setup('grid');
    document.body.innerHTML = windowHtml({ hint: 'Выбор карт из общего каталога', isMenuOpen: true }) + menuHtml();
    picker.sort.sync(database, settings);
    expect(own()).toBeNull();
    document.body.innerHTML = catalogHtml + menuHtml();
    picker.sort.sync(database, settings);
    grid.sort.sync(database, settings);
    expect(own()).toBeNull();
    document.body.innerHTML = deckHtml(true) + '<div class="modal-content modal-content--card"></div>' + menuHtml();
    picker.sort.sync(database, settings);
    expect(own()).toBeNull();
  });

  it('give the menu of a window open over the profile grid to the window, not to the grid', () => {
    render();
    document.body.insertAdjacentHTML('beforeend', windowHtml({ isMenuOpen: true }) + menuHtml());
    setup('grid').sort.sync(database, settings);
    expect(own()).toBeNull();
    setup('picker').sort.sync(database, settings);
    expect(own()).not.toBeNull();
  });

  it('turn on in the window the menu was opened from, start the list of the pickers and close the menu through its button, whatever its label', () => {
    document.body.innerHTML = windowHtml({ isMenuOpen: true, label: 'Сортировка' }) + menuHtml();
    const { sort, views, choose } = setup('picker');
    sort.sync(database, settings);
    const closed = vi.fn();
    document.querySelector('#window-sort')?.addEventListener('click', closed);
    choose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(windowToolbar()?.getAttribute('data-senkutools-sort')).toBe('price');
    expect(views).toEqual([true]);
    sort.sync(database, settings);
    expect(windowLabel()).toBe('Сортировка');
    expect(own()?.checked).toBe(true);
  });

  it('leave a click alone that the grid sort gets from the menu of a window', () => {
    render();
    document.body.insertAdjacentHTML('beforeend', windowHtml({ isMenuOpen: true }) + menuHtml());
    const picker = setup('picker');
    picker.sort.sync(database, settings);
    const grid = setup('grid');
    press(grid.sort, own());
    expect(grid.views).toEqual([]);
    expect(filters()?.hasAttribute('data-senkutools-sort')).toBe(false);
  });

  it('label the button of a window that shows the sort, and dim its list while the list loads, then show it as the page draws it', () => {
    document.body.innerHTML = windowHtml();
    const { sort, state } = setup('picker');
    windowToolbar()?.setAttribute('data-senkutools-sort', 'price');
    sort.sync(database, settings);
    state('loading', 5, 10);
    sort.sync(database, settings);
    expect(windowLabel()).toBe('По цене 50%');
    expect(windowResults()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
    state('ready', 10, 10);
    sort.sync(database, settings);
    expect(windowLabel()).toBe('По цене');
    expect(windowResults()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
    expect(windowRowOrders()).toEqual(['', '']);
  });

  it('end when the window moves to its catalog step, and stay off when the window comes back to the cards', () => {
    document.body.innerHTML = windowHtml();
    const { sort, views } = setup('picker');
    windowToolbar()?.setAttribute('data-senkutools-sort', 'price');
    sort.sync(database, settings);
    setHint('Выбор карт из общего каталога');
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
    expect(windowToolbar()?.hasAttribute('data-senkutools-sort')).toBe(false);
    setHint('Выбери до 50 карт');
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
  });

  it('end, and leave the list of the site as it is, when the view cannot run there: no partial order outside the profile grid', () => {
    for (const name of ['unavailable', 'failed'] as const) {
      document.body.innerHTML = windowHtml({ slugs: ['cheap', 'dear', 'mid'] });
      const { sort, views, state } = setup('picker');
      windowToolbar()?.setAttribute('data-senkutools-sort', 'price');
      sort.sync(database, settings);
      state('loading', 1, 3);
      sort.sync(database, settings);
      state(name);
      sort.sync(database, settings);
      expect(views).toEqual([true, false]);
      expect(windowToolbar()?.hasAttribute('data-senkutools-sort')).toBe(false);
      expect(windowLabel()).toBe('По дате получения');
      expect(windowResults()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
      expect(windowRowOrders()).toEqual(['', '', '']);
    }
  });

  it('end the same way when nothing is heard from the page for a long time', () => {
    document.body.innerHTML = windowHtml();
    const { sort, views, timers } = setup('picker');
    windowToolbar()?.setAttribute('data-senkutools-sort', 'price');
    sort.sync(database, settings);
    timers.shift()?.();
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
    expect(windowToolbar()?.hasAttribute('data-senkutools-sort')).toBe(false);
  });

  it('end in the deck builder and start again in a window when the price is chosen in a window over it, one view per kind of list', () => {
    document.body.innerHTML = deckHtml();
    const { sort, views, choose } = setup('picker');
    deckToolbar()?.setAttribute('data-senkutools-sort', 'price');
    sort.sync(database, settings);
    document.body.insertAdjacentHTML('beforeend', windowHtml({ isMenuOpen: true }) + menuHtml());
    sort.sync(database, settings);
    choose();
    expect(views).toEqual([true, false, true]);
    expect(deckToolbar()?.hasAttribute('data-senkutools-sort')).toBe(false);
    expect(windowToolbar()?.getAttribute('data-senkutools-sort')).toBe('price');
  });

  it('end when the window closes', () => {
    document.body.innerHTML = windowHtml();
    const { sort, views } = setup('picker');
    windowToolbar()?.setAttribute('data-senkutools-sort', 'price');
    sort.sync(database, settings);
    document.querySelector('.modal-content--trade')?.remove();
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
  });

  it('do not take what the page says about the other kind of list', () => {
    render();
    const { sort, host, orders, state, rows } = setup('grid');
    enablePriceMode();
    sort.sync(database, settings);
    const before = vi.mocked(host.schedule).mock.calls.length;
    state('failed', 0, null, 'picker');
    rows(1, ['mid'], 'picker');
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before);
    expect(orders).toEqual([]);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });

  it('are noticed when a window, its header, toolbar or list, or the deck builder changes, and when a window is taken away', () => {
    document.body.innerHTML = windowHtml() + deckHtml();
    const record = (target: Node, removed: Node[] = []): MutationRecord =>
      ({ target, addedNodes: [] as unknown as NodeList, removedNodes: removed as unknown as NodeList }) as MutationRecord;
    for (const selector of ['.modal-trade__header-hint', '#window-sort span', '.modal-trade__body-result', '.card-browse__form', '.card-browse__cnt-result']) {
      expect(hasSortMutation([record(document.querySelector(selector)!)])).toBe(true);
    }
    const closed = document.querySelector('.modal-content--trade')!;
    closed.remove();
    expect(hasSortMutation([record(document.body, [closed])])).toBe(true);
  });
});

describe('a price range', () => {
  const rangeOf = (toolbar: Element | null) => toolbar?.getAttribute('data-senkutools-price-range') ?? null;

  const ranged = (range: PriceRange = { min: 15, max: 400 }, scope: ListScope = 'grid') => {
    const harness = setup(scope);
    harness.sort.sync(database, settings);
    harness.sort.applyRange(scope === 'grid' ? (filters() as Element) : (windowToolbar() as Element), range);
    harness.sort.sync(database, settings);
    return harness;
  };

  it('starts the view in the order of the site, and sends only the rows in the range, in the order of the list, the same both ways', () => {
    render();
    const { views, sorts, orders, rows, state } = ranged();
    expect(rangeOf(filters())).toBe('15:400');
    expect(views).toEqual([true]);
    expect(sorts).toEqual(['site']);
    state('loading', 0, 3);
    rows(1, ['mid', 'dear', 'cheap', null, 'twin']);
    expect(orders).toEqual([{ viewId: 1, revision: 1, descending: [0, 1, 4], ascending: [0, 1, 4] }]);
  });

  it('leaves the label of the site sort alone and dims the list while it loads', () => {
    render();
    const { sort, state } = ranged();
    state('loading', 1, 3);
    sort.sync(database, settings);
    expect(label()).toBe('По дате получения');
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
    state('ready', 3, 3);
    sort.sync(database, settings);
    expect(grid()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
  });

  it('sends the rows in the range by price when the price sort is on as well', () => {
    render();
    enablePriceMode();
    const { sorts, orders, rows, state } = ranged({ min: 1.5, max: 20 });
    expect(sorts).toEqual(['price']);
    state('loading');
    rows(1, ['mid', 'dear', 'cheap', 'twin', 'nope']);
    expect(orders.at(-1)).toMatchObject({ descending: [0, 3, 2], ascending: [2, 0, 3] });
  });

  it('compares the price the badge shows, so a bound on a rounded price takes the card in', () => {
    render();
    const { orders, rows, state } = ranged({ min: 20, max: 20 });
    state('loading');
    rows(1, ['mid', 'twin', 'dear']);
    expect(orders.at(-1)).toMatchObject({ descending: [0, 1] });
  });

  it('takes the commission in, the way the badges do', () => {
    render();
    const { sort, orders, rows, state } = ranged({ min: 16, max: 16 });
    state('loading');
    rows(1, ['mid', 'dear']);
    expect(orders.at(-1)).toMatchObject({ descending: [] });
    sort.sync(database, { commission: true });
    expect(orders.at(-1)).toMatchObject({ revision: 2, descending: [0] });
  });

  it('sends a newer order for another range, with the same view, and nothing for the same range again', () => {
    render();
    const { sort, views, orders, rows, state } = ranged();
    state('loading');
    rows(1, ['mid', 'dear', 'cheap']);
    state('ready', 3, 3);
    sort.applyRange(filters() as Element, { min: 15, max: 400 });
    sort.sync(database, settings);
    expect(orders).toHaveLength(1);
    sort.applyRange(filters() as Element, { min: null, max: 2 });
    sort.sync(database, settings);
    expect(views).toEqual([true]);
    expect(orders.at(-1)).toEqual({ viewId: 1, revision: 2, descending: [2], ascending: [2] });
  });

  it('ends the view and gives back the list of the site when the range is cleared under the site sort', () => {
    render();
    const { sort, views } = ranged();
    sort.applyRange(filters() as Element, null);
    expect(rangeOf(filters())).toBeNull();
    expect(views).toEqual([true, false]);
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
  });

  it('keeps the price sort when the range is cleared under it, and sends every row again', () => {
    render();
    enablePriceMode();
    const { sort, views, orders, rows, state } = ranged({ min: 1.5, max: 20 });
    state('loading');
    rows(1, ['mid', 'dear', 'cheap']);
    sort.applyRange(filters() as Element, null);
    sort.sync(database, settings);
    expect(views).toEqual([true]);
    expect(orders.at(-1)).toMatchObject({ revision: 2, descending: [1, 0, 2], ascending: [2, 0, 1] });
  });

  it('switches the view to the price order when the price is chosen with a range on, and back to the order of the site when a site item is chosen, keeping the range', () => {
    render({ hasMenu: true });
    const { sort, views, sorts, orders, rows, state, choose } = ranged();
    state('loading');
    rows(1, ['mid', 'dear', 'cheap']);
    choose();
    expect(filters()?.getAttribute('data-senkutools-sort')).toBe('price');
    expect(views).toEqual([true, true]);
    expect(sorts).toEqual(['site', 'price']);
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    expect(orders.at(-1)).toMatchObject({ revision: 2, descending: [1, 0], ascending: [0, 1] });
    press(sort, document.querySelector('#cards-browse-order label.radio--list input'));
    expect(filters()?.hasAttribute('data-senkutools-sort')).toBe(false);
    expect(rangeOf(filters())).toBe('15:400');
    expect(sorts).toEqual(['site', 'price', 'site']);
    sort.sync(database, settings);
    expect(label()).toBe('По дате получения');
    expect(orders.at(-1)).toMatchObject({ revision: 3, descending: [0, 1], ascending: [0, 1] });
  });

  it('waits for the rows of a list crawled again after a switch, instead of ordering the old rows', () => {
    render({ hasMenu: true });
    enablePriceMode();
    const { sort, orders, rows, state } = ranged();
    state('loading');
    rows(1, ['mid', 'dear', 'cheap']);
    state('ready', 3, 3);
    press(sort, document.querySelector('#cards-browse-order label.radio--list input'));
    state('loading', 0, null);
    sort.sync(database, settings);
    expect(orders).toHaveLength(1);
    rows(2, ['dear', 'mid']);
    expect(orders.at(-1)).toEqual({ viewId: 2, revision: 1, descending: [0, 1], ascending: [0, 1] });
  });

  it('falls open: when the page says it cannot, or says nothing for a long time, the range is taken off and the list of the site stays whole', () => {
    for (const ending of ['unavailable', 'failed', 'stall'] as const) {
      render();
      const { sort, views, state, timers } = ranged();
      if (ending === 'stall') timers.shift()?.();
      else state(ending);
      sort.sync(database, settings);
      expect(views, ending).toEqual([true, false]);
      expect(rangeOf(filters()), ending).toBeNull();
      expect(grid()?.hasAttribute('data-senkutools-sort-state'), ending).toBe(false);
      expect(cards().map(placeOf), ending).toEqual(['', '', '']);
    }
  });

  it('keeps the partial price order of the profile grid when it falls open, without the range, so no card is hidden', () => {
    render({ slugs: ['cheap', 'dear', 'mid'] });
    enablePriceMode();
    const { sort, state } = ranged({ min: 100, max: null });
    state('failed');
    sort.sync(database, settings);
    expect(rangeOf(filters())).toBeNull();
    expect(label()).toBe('По цене (часть)');
    expect(slugsByPlace()).toEqual(['dear', 'mid', 'cheap']);
  });

  it('ends a range in another place of the same kind, the same rule as the price sort', () => {
    document.body.innerHTML = deckHtml();
    const { sort, views } = setup('picker');
    sort.sync(database, settings);
    sort.applyRange(deckToolbar() as Element, { min: 1, max: 2 });
    document.body.insertAdjacentHTML('beforeend', windowHtml());
    sort.sync(database, settings);
    sort.applyRange(windowToolbar() as Element, { min: 5, max: null });
    expect(rangeOf(deckToolbar())).toBeNull();
    expect(rangeOf(windowToolbar())).toBe('5:');
    expect(views).toEqual([true, false, true]);
  });

  it('is ended in the window when the window moves to its catalog step, and is never set there', () => {
    document.body.innerHTML = windowHtml();
    const { sort, views } = ranged({ min: 1, max: 2 }, 'picker');
    setHint('Выбор карт из общего каталога');
    sort.sync(database, settings);
    expect(rangeOf(windowToolbar())).toBeNull();
    expect(views).toEqual([true, false]);
    sort.applyRange(windowToolbar() as Element, { min: 1, max: 2 });
    expect(rangeOf(windowToolbar())).toBeNull();
  });

  it('is left alone by the sort of the other kind of list', () => {
    render();
    const picker = setup('picker');
    picker.sort.applyRange(filters() as Element, { min: 1, max: 2 });
    expect(rangeOf(filters())).toBeNull();
    expect(picker.views).toEqual([]);
  });
});

describe('the range control in the lists', () => {
  const controlIn = (toolbar: Element | null) => toolbar?.querySelector(':scope > .senkutools-price-filter') ?? null;
  const triggerIn = (toolbar: Element | null) => toolbar?.querySelector<HTMLButtonElement>('.senkutools-price-filter__trigger') ?? null;
  const fieldsIn = (toolbar: Element | null) => [...(toolbar?.querySelectorAll<HTMLInputElement>('.senkutools-price-filter__input') ?? [])];

  beforeEach(() => document.documentElement.setAttribute('data-senkutools-guard', 'ready'));
  afterEach(() => document.documentElement.removeAttribute('data-senkutools-guard'));

  it('is drawn in every list of its own kind once the page script is in place, and nowhere before', () => {
    document.documentElement.removeAttribute('data-senkutools-guard');
    render();
    const grid = setup('grid');
    grid.sort.sync(database, settings);
    expect(controlIn(filters())).toBeNull();
    document.documentElement.setAttribute('data-senkutools-guard', 'ready');
    setup('picker').sort.sync(database, settings);
    expect(controlIn(filters())).toBeNull();
    grid.sort.sync(database, settings);
    expect(controlIn(filters())).not.toBeNull();
    expect(triggerIn(filters())?.className).not.toContain('__mob');
  });

  it('is drawn in the windows and the deck builder with the class the place hides labels with on phones, and not on the catalog step', () => {
    document.body.innerHTML = windowHtml() + deckHtml();
    const { sort } = setup('picker');
    sort.sync(database, settings);
    expect(triggerIn(windowToolbar())?.classList.contains('modal-trade__header-form__mob')).toBe(true);
    expect(triggerIn(deckToolbar())?.classList.contains('card-browse__form__mob')).toBe(true);
    setHint('Выбор карт из общего каталога');
    sort.sync(database, settings);
    expect(controlIn(windowToolbar())).toBeNull();
    expect(controlIn(deckToolbar())).not.toBeNull();
  });

  it('applies what is typed into it: the range goes on the toolbar and the view starts in the order of the site', () => {
    render();
    const { sort, views, sorts } = setup('grid');
    sort.sync(database, settings);
    const [min, max] = fieldsIn(filters());
    triggerIn(filters())?.click();
    if (min) min.value = '10';
    if (max) max.value = '400';
    max?.dispatchEvent(new Event('change'));
    expect(filters()?.getAttribute('data-senkutools-price-range')).toBe('10:400');
    expect(views).toEqual([true]);
    expect(sorts).toEqual(['site']);
  });

  it('says how far the list is while it loads for a range, and only Цена otherwise', () => {
    render();
    const { sort, state } = setup('grid');
    sort.sync(database, settings);
    sort.applyRange(filters() as Element, { min: 10, max: null });
    state('loading', 30, 120);
    sort.sync(database, settings);
    expect(triggerIn(filters())?.textContent).toBe('Цена 25%');
    expect(triggerIn(filters())?.classList.contains('button--chip')).toBe(true);
    state('ready', 120, 120);
    sort.sync(database, settings);
    expect(triggerIn(filters())?.textContent).toBe('Цена');
  });

  it('shows the price sort progress on the sort button and not on itself when no range is on', () => {
    render();
    enablePriceMode();
    const { sort, state } = setup('grid');
    sort.sync(database, settings);
    state('loading', 30, 120);
    sort.sync(database, settings);
    expect(label()).toBe('По цене 25%');
    expect(triggerIn(filters())?.textContent).toBe('Цена');
  });

  it('loses its mark when its range is ended by a range in another place of the same kind', () => {
    document.body.innerHTML = deckHtml();
    const { sort } = setup('picker');
    sort.sync(database, settings);
    sort.applyRange(deckToolbar() as Element, { min: 1, max: 2 });
    sort.sync(database, settings);
    expect(triggerIn(deckToolbar())?.classList.contains('button--chip')).toBe(true);
    document.body.insertAdjacentHTML('beforeend', windowHtml());
    sort.sync(database, settings);
    sort.applyRange(windowToolbar() as Element, { min: 5, max: null });
    sort.sync(database, settings);
    expect(triggerIn(deckToolbar())?.classList.contains('button--chip')).toBe(false);
    expect(fieldsIn(deckToolbar()).map((field) => field.value)).toEqual(['', '']);
    expect(triggerIn(windowToolbar())?.classList.contains('button--chip')).toBe(true);
  });
});

describe('the empty note of a price range', () => {
  const note = () => document.querySelector('.senkutools-price-filter__empty');

  const emptied = (scope: ListScope, toolbar: () => Element | null) => {
    const harness = setup(scope);
    harness.sort.sync(database, settings);
    harness.sort.applyRange(toolbar() as Element, { min: 1000, max: null });
    harness.state('loading');
    harness.rows(1, ['mid', 'dear', 'cheap']);
    return harness;
  };

  it('says the range holds no card once the empty list is served, hides the empty text of the site meanwhile, and goes when cards come back', () => {
    render();
    document.body.innerHTML = `<section>${document.body.innerHTML}<div class="empty">Нет карточек</div></section>`;
    const { sort, orders, state } = emptied('grid', filters);
    expect(orders.at(-1)).toMatchObject({ descending: [], ascending: [] });
    sort.sync(database, settings);
    expect(note()).toBeNull();
    state('ready', 3, 3);
    sort.sync(database, settings);
    expect(note()?.textContent).toBe('Нет карт в этом диапазоне цен');
    expect(note()?.parentElement?.tagName).toBe('SECTION');
    expect(note()?.parentElement?.hasAttribute('data-senkutools-price-empty')).toBe(true);
    sort.applyRange(filters() as Element, { min: 1, max: null });
    sort.sync(database, settings);
    expect(note()).toBeNull();
    expect(document.querySelector('section')?.hasAttribute('data-senkutools-price-empty')).toBe(false);
  });

  it('stands after the list of a window, and goes when the range is cleared', () => {
    document.body.innerHTML = windowHtml();
    const { sort, state, views } = emptied('picker', windowToolbar);
    state('ready', 3, 3);
    sort.sync(database, settings);
    expect(note()?.previousElementSibling).toBe(windowResults());
    sort.applyRange(windowToolbar() as Element, null);
    sort.sync(database, settings);
    expect(note()).toBeNull();
    expect(views).toEqual([true, false]);
  });

  it('is not shown while a range lets cards through, nor for an empty list with no range', () => {
    render();
    document.body.innerHTML = `<section>${document.body.innerHTML}</section>`;
    const { sort, state, rows } = setup('grid');
    sort.sync(database, settings);
    sort.applyRange(filters() as Element, { min: 1, max: null });
    state('loading');
    rows(1, ['mid']);
    state('ready', 1, 1);
    sort.sync(database, settings);
    expect(note()).toBeNull();
    enablePriceMode();
    sort.applyRange(filters() as Element, null);
    sort.sync(database, settings);
    expect(note()).toBeNull();
  });
});

describe('the paging sentinel of a list the view serves', () => {
  let observers: ReturnType<typeof installIntersectionObservers>;
  const sentinel = () => grid()?.querySelector(':scope > div:not(.card-collect-preview)');
  const isParked = () => sentinel()?.hasAttribute('data-senkutools-paging-parked') ?? false;
  const redraw = (slugs: string[], hasMoreCards: boolean) => {
    const list = grid() as HTMLElement;
    list.innerHTML = `${slugs.map(cardHtml).join('')}${hasMoreCards ? '<div></div>' : ''}`;
  };

  const served = () => {
    const harness = setup('grid');
    harness.sort.sync(database, settings);
    harness.sort.applyRange(filters() as Element, { min: 1, max: null });
    harness.state('loading');
    harness.rows(1, ['mid', 'dear', 'cheap']);
    harness.state('ready', 3, 3);
    harness.sort.sync(database, settings);
    return harness;
  };

  beforeEach(() => {
    observers = installIntersectionObservers();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is moved out of view and back when a served list is drawn again shorter, with its end in view, so the site asks for the next page', () => {
    render({ slugs: ['mid', 'dear', 'cheap'] });
    const { sort } = served();
    redraw(['dear', 'mid'], true);
    sort.sync(database, settings);
    observers.report(true);
    expect(isParked()).toBe(true);
    observers.report(false);
    expect(isParked()).toBe(false);
  });

  it('is moved again when the site draws the real list back after the view stops', () => {
    render({ slugs: ['mid', 'dear', 'cheap'] });
    const { sort, views } = served();
    sort.applyRange(filters() as Element, null);
    sort.sync(database, settings);
    expect(views).toEqual([true, false]);
    redraw(['cheap', 'mid'], true);
    sort.sync(database, settings);
    observers.report(true);
    expect(isParked()).toBe(true);
  });

  it('is left to the site in a list the view never served', () => {
    render({ slugs: ['mid', 'dear'], hasMoreCards: true });
    const { sort, state, rows } = setup('grid');
    sort.sync(database, settings);
    sort.applyRange(filters() as Element, { min: 1, max: null });
    state('loading');
    rows(1, ['mid', 'dear']);
    redraw(['mid'], true);
    sort.sync(database, settings);
    expect(observers.observations).toHaveLength(0);
  });
});
