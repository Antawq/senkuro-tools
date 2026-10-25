import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../utils/shared/database';
import { PRICE_STATE_EVENT, PRICE_ROWS_EVENT, encodePriceRows, encodePriceState, type PriceOrder, type PriceStateName } from '../utils/shared/price-signal';
import { createPriceSort, hasSortMutation, type PriceSort, type SortHost } from '../utils/sort/sort-view';

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
      ? `<div class="back-actions"><div class="user-card__filters"><button class="button button--icon${isAscending ? ' cards-cnt__nav-filter--asc' : ''}" id="direction"></button><div class="v-popper"><button id="sort-trigger" class="button"><span>По дате получения</span></button></div><div class="v-popper"><button id="filter-trigger" class="button"><span>Фильтр</span></button></div></div></div>`
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

const setup = () => {
  const views: boolean[] = [];
  const orders: PriceOrder[] = [];
  const timers: (() => void)[] = [];
  const host: SortHost = {
    setView: (isOn) => void views.push(isOn),
    sendOrder: (order) => void orders.push(order),
    runAfter: (run) => void timers.push(run),
    schedule: vi.fn<() => void>(),
  };
  const sort = createPriceSort(document, host);
  const choose = () => press(sort, own());
  const state = (name: PriceStateName, loaded = 0, total: number | null = null) =>
    sort.handleState(new CustomEvent(PRICE_STATE_EVENT, { detail: encodePriceState({ name, loaded, total }) }));
  const rows = (viewId: number, slugs: (string | null)[]) => sort.handleRows(new CustomEvent(PRICE_ROWS_EVENT, { detail: encodePriceRows({ viewId, slugs }) }));
  return { sort, host, views, orders, timers, choose, state, rows };
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
    const { sort, host, choose, views } = setup();
    sort.sync(database, settings);
    const closed = vi.fn();
    document.querySelector('#sort-trigger')?.addEventListener('click', closed);
    choose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(filters()?.getAttribute('data-senkutools-sort')).toBe('price');
    expect(views).toEqual([true]);
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
    sort.handleState(new CustomEvent(PRICE_STATE_EVENT, { detail: encodePriceState({ name: 'failed', loaded: 0, total: null }) }));
    sort.handleRows(new CustomEvent(PRICE_ROWS_EVENT, { detail: encodePriceRows({ viewId: 1, slugs: ['mid'] }) }));
    expect(host.schedule).not.toHaveBeenCalled();
    enablePriceMode();
    sort.sync(database, settings);
    const before = vi.mocked(host.schedule).mock.calls.length;
    sort.handleState(new CustomEvent(PRICE_STATE_EVENT, { detail: 'nonsense' }));
    sort.handleState(new CustomEvent(PRICE_STATE_EVENT));
    sort.handleRows(new CustomEvent(PRICE_ROWS_EVENT, { detail: 'nonsense' }));
    sort.handleRows(new CustomEvent(PRICE_ROWS_EVENT));
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before);
    expect(views).toEqual([true]);
    expect(orders).toEqual([]);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });
});

describe('hasSortMutation', () => {
  const record = (target: Node, added: Node[] = []): MutationRecord => ({ target, addedNodes: added as unknown as NodeList }) as MutationRecord;

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
