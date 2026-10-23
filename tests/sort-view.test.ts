import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../utils/shared/database';
import { LIST_LOADED_EVENT, encodeLoaded, type LoadOutcome } from '../utils/shared/list-signal';
import { createPriceSort, touchesSort, type PriceSort, type SortHost } from '../utils/sort/sort-view';

const database: Database = {
  cheap: { price: 1.5, name: 'Cheap', rank: 'F' },
  mid: { price: 20, name: 'Mid', rank: 'D' },
  dear: { price: 300, name: 'Dear', rank: 'S' },
  twin: { price: 20.004, name: 'Twin', rank: 'D' },
};

const SORT_ITEMS = ['Рангу', 'Количеству', 'Популярности', 'Персонажу', 'Произведению', 'Дате получения', 'Дате обновления'];

const radio = (text: string, checked: boolean) =>
  `<label class="radio radio-size--md radio--list"><input type="radio" value="${text}"${checked ? ' checked=""' : ''}><div class="radio__label"><!----><span>${text}</span><!----></div></label>`;

const menuHtml = (checkedIndex = 5) =>
  `<div id="cards-browse-order" class="v-popper__popper"><div class="dropdown-menu dropdown-menu--sm"><div class="dropdown-menu__caption"> Сортировать по </div>${SORT_ITEMS.map((text, index) => radio(text, index === checkedIndex)).join('')}</div></div>`;

const cardHtml = (slug: string, index: number) =>
  `<div class="card-collect-preview user-card" data-index="${index}"><a href="/cards/${slug}" class="card-collect"></a><div class="card-collect-preview__back"><a href="/cards/${slug}" class="card-collect card-collect--flip"></a></div></div>`;

interface Page {
  slugs?: string[];
  more?: boolean;
  ascending?: boolean;
  menu?: boolean;
  filters?: boolean;
}

const render = ({ slugs = ['mid', 'dear', 'cheap'], more = false, ascending = false, menu = false, filters = true }: Page = {}) => {
  document.body.innerHTML = `${
    filters
      ? `<div class="back-actions"><div class="user-card__filters"><button class="button button--icon${ascending ? ' cards-cnt__nav-filter--asc' : ''}" id="direction"></button><div class="v-popper"><button id="sort-trigger" class="button"><span>По дате получения</span></button></div><div class="v-popper"><button id="filter-trigger" class="button"><span>Фильтр</span></button></div></div></div>`
      : ''
  }<div class="user-cards-grid">${slugs.map(cardHtml).join('')}${more ? '<div></div>' : ''}</div>${menu ? menuHtml() : ''}`;
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

const setup = () => {
  const requests = { count: 0 };
  const timers: (() => void)[] = [];
  const host: SortHost = {
    requestListLoad: () => void (requests.count += 1),
    runAfter: (run) => void timers.push(run),
    schedule: vi.fn<() => void>(),
  };
  const sort = createPriceSort(document, host);
  const choose = () => press(sort, own());
  const answered = (outcome: LoadOutcome) => sort.handleLoaded(new CustomEvent(LIST_LOADED_EVENT, { detail: encodeLoaded(outcome) }));
  const loaded = (complete: boolean) => answered(complete ? 'complete' : 'partial');
  const moved = () => answered('moved');
  return { sort, host, requests, timers, choose, loaded, moved };
};

const on = () => filters()?.setAttribute('data-senkutools-sort', 'price');

const press = (sort: PriceSort, element: Element | null): void => {
  document.addEventListener('click', sort.handleClick, true);
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.removeEventListener('click', sort.handleClick, true);
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the menu', () => {
  it('gets a last item for the price, built like the site items and unchecked', () => {
    render({ menu: true });
    const { sort } = setup();
    sort.sync(database, settings);
    const items = [...document.querySelectorAll('#cards-browse-order label.radio--list')];
    expect(items).toHaveLength(SORT_ITEMS.length + 1);
    const added = items.at(-1) as HTMLElement;
    expect(added.className).toBe(items[0]?.className);
    expect(added.textContent?.trim()).toBe('Цене');
    expect(own()?.value).toBe('price');
    expect(own()?.checked).toBe(false);
  });

  it('leaves the item the site checked alone while the mode is off', () => {
    render({ menu: true });
    const { sort } = setup();
    sort.sync(database, settings);
    expect(checkedItems()).toEqual(['Дате получения']);
  });

  it('is decorated once, however often it is looked at', () => {
    render({ menu: true });
    const { sort } = setup();
    sort.sync(database, settings);
    sort.sync(database, settings);
    expect(document.querySelectorAll('[data-senkutools-sort-item]')).toHaveLength(1);
  });

  it('is left alone when it is not the cards page, or a window is open over it, or the menu is not the sort menu of this page', () => {
    render({ menu: true, filters: false });
    const first = setup();
    first.sort.sync(database, settings);
    expect(own()).toBeNull();
    render({ menu: true });
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
  it('turns it on, closes the menu through its button, labels the button and shows the item as the checked one', () => {
    render({ menu: true });
    const { sort, host, choose } = setup();
    sort.sync(database, settings);
    const closed = vi.fn();
    document.querySelector('#sort-trigger')?.addEventListener('click', closed);
    choose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(filters()?.getAttribute('data-senkutools-sort')).toBe('price');
    expect(host.schedule).toHaveBeenCalled();
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    expect(own()?.checked).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('#cards-browse-order input')].filter((input) => input.checked)).toHaveLength(1);
  });

  it('shows it as the checked item when the menu is opened again later', () => {
    render();
    const { sort } = setup();
    on();
    document.body.insertAdjacentHTML('beforeend', menuHtml());
    sort.sync(database, settings);
    expect(own()?.checked).toBe(true);
    expect(document.querySelectorAll<HTMLInputElement>('#cards-browse-order input:checked')).toHaveLength(1);
  });

  it('chooses once when the label is clicked, although the browser follows that with a click on the field', () => {
    render({ menu: true });
    const { sort } = setup();
    sort.sync(database, settings);
    const closed = vi.fn();
    document.querySelector('#sort-trigger')?.addEventListener('click', closed);
    press(sort, document.querySelector('[data-senkutools-sort-item]'));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(filters()?.getAttribute('data-senkutools-sort')).toBe('price');
  });

  it('turns off when any item of the site is chosen, and gives the button its own label back', () => {
    render({ menu: true });
    const { sort, host } = setup();
    on();
    sort.sync(database, settings);
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    const before = vi.mocked(host.schedule).mock.calls.length;
    press(sort, document.querySelector('#cards-browse-order label.radio--list input'));
    expect(filters()?.getAttribute('data-senkutools-sort')).toBeNull();
    expect(vi.mocked(host.schedule).mock.calls.length).toBeGreaterThan(before);
    sort.sync(database, settings);
    expect(label()).toBe('По дате получения');
    expect(filters()?.hasAttribute('data-senkutools-sort-label')).toBe(false);
    expect(grid()?.hasAttribute('data-senkutools-sort-state')).toBe(false);
  });

  it('leaves the button text to the site when the site already changed it', () => {
    render({ menu: true });
    const { sort } = setup();
    on();
    sort.sync(database, settings);
    document.querySelector('#sort-trigger span')!.textContent = 'По рангу';
    filters()?.removeAttribute('data-senkutools-sort');
    sort.sync(database, settings);
    expect(label()).toBe('По рангу');
  });

  it('does nothing when an item of the site is chosen and the price was not on', () => {
    render({ menu: true });
    const { sort, host } = setup();
    sort.sync(database, settings);
    press(sort, document.querySelector('#cards-browse-order label.radio--list input'));
    expect(host.schedule).not.toHaveBeenCalled();
  });

  it('finds the sort button by its text, not by its place among the buttons', () => {
    render({ menu: true });
    const filterPopper = document.querySelector('#filter-trigger')!.parentElement!;
    document.querySelector('.user-card__filters')!.insertBefore(filterPopper, document.querySelector('#sort-trigger')!.parentElement);
    const { sort } = setup();
    on();
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    expect(document.querySelector('#filter-trigger span')?.textContent).toBe('Фильтр');
  });

  it('does nothing for clicks elsewhere', () => {
    render({ menu: true });
    const { sort, host } = setup();
    sort.sync(database, settings);
    sort.handleClick(new MouseEvent('click'));
    press(sort, document.querySelector('#filter-trigger'));
    press(sort, document.querySelector('#cards-browse-order .dropdown-menu__caption'));
    press(sort, document.querySelector('.user-card'));
    expect(host.schedule).not.toHaveBeenCalled();
  });
});

describe('ordering the cards', () => {
  it('puts the most expensive first, the way the site lists newest and largest first', () => {
    render();
    const { sort } = setup();
    on();
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['dear', 'mid', 'cheap']);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('ready');
    expect(label()).toBe('По цене');
  });

  it('turns around with the direction button of the site', () => {
    render({ ascending: true });
    const { sort } = setup();
    on();
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['cheap', 'mid', 'dear']);
  });

  it('prices cards the way their badges show, so equal-looking prices keep the site order', () => {
    render({ slugs: ['twin', 'mid', 'dear'] });
    const { sort } = setup();
    on();
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['dear', 'twin', 'mid']);
  });

  it('prices cards the way their badges show, with the commission taken when it is', () => {
    render({ slugs: ['a', 'b'] });
    const { sort } = setup();
    on();
    const prices: Database = { a: { price: 100.004, name: 'A', rank: 'F' }, b: { price: 100.006, name: 'B', rank: 'F' } };
    sort.sync(prices, { commission: false });
    expect(slugsByPlace()).toEqual(['b', 'a']);
    sort.sync(prices, { commission: true });
    expect(slugsByPlace()).toEqual(['a', 'b']);
  });

  it('counts a price that is not a number as no price', () => {
    render({ slugs: ['bad', 'cheap', 'worse', 'dear'] });
    const { sort } = setup();
    on();
    sort.sync({ ...database, bad: { price: Number.NaN, name: 'x', rank: 'F' }, worse: { price: null as unknown as number, name: 'y', rank: 'F' } }, settings);
    expect(slugsByPlace()).toEqual(['dear', 'cheap', 'bad', 'worse']);
  });

  it('puts cards the database does not know at the end, in the site order', () => {
    render({ slugs: ['stranger', 'cheap', 'unknown', 'dear'] });
    const { sort } = setup();
    on();
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['dear', 'cheap', 'stranger', 'unknown']);
  });

  it('puts in order the cards that arrive later, and takes the order off when the mode ends', () => {
    render({ slugs: ['cheap', 'mid'] });
    const { sort } = setup();
    on();
    sort.sync(database, settings);
    document.querySelector('.user-cards-grid')?.insertAdjacentHTML('beforeend', cardHtml('dear', 2));
    sort.sync(database, settings);
    expect(slugsByPlace()).toEqual(['dear', 'mid', 'cheap']);
    filters()?.removeAttribute('data-senkutools-sort');
    sort.sync(database, settings);
    expect(cards().map(placeOf)).toEqual(['', '', '']);
  });

  it('does nothing when the cards page is not there', () => {
    render({ filters: false });
    const { sort, requests } = setup();
    sort.sync(database, settings);
    expect(requests.count).toBe(0);
    expect(cards().map(placeOf)).toEqual(['', '', '']);
  });

  it('labels the button even before the cards are there', () => {
    render();
    document.querySelector('.user-cards-grid')?.remove();
    const { sort } = setup();
    on();
    expect(() => sort.sync(database, settings)).not.toThrow();
    expect(label()).toBe('По цене');
  });
});

describe('a list that is not all there', () => {
  it('asks for the rest once, keeps the site order and dims the grid until it has come', () => {
    render({ more: true });
    const { sort, requests } = setup();
    on();
    sort.sync(database, settings);
    sort.sync(database, settings);
    expect(requests.count).toBe(1);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
    expect(cards().map(placeOf)).toEqual(['', '', '']);
    expect(label()).toBe('По цене');
  });

  it('orders the whole list once the rest has come', () => {
    render({ more: true });
    const { sort, loaded } = setup();
    on();
    sort.sync(database, settings);
    grid()?.insertAdjacentHTML('afterbegin', cardHtml('twin', 9));
    grid()?.lastElementChild?.remove();
    loaded(true);
    sort.sync(database, settings);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('ready');
    expect(slugsByPlace()).toEqual(['dear', 'twin', 'mid', 'cheap']);
  });

  it('shows what it has, says so, and does not ask again, when the rest could not be loaded', () => {
    render({ more: true });
    const { sort, requests, loaded } = setup();
    on();
    sort.sync(database, settings);
    loaded(false);
    sort.sync(database, settings);
    sort.sync(database, settings);
    expect(requests.count).toBe(1);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('partial');
    expect(slugsByPlace()).toEqual(['dear', 'mid', 'cheap']);
    expect(label()).toBe('По цене (часть)');
    expect(document.querySelector('#sort-trigger')?.getAttribute('title')).toBe('Отсортированы только загруженные карты');
  });

  it('asks for the list the site moved to when the load it started was left half way by that move', () => {
    render({ more: true });
    const { sort, requests, moved } = setup();
    on();
    sort.sync(database, settings);
    expect(requests.count).toBe(1);
    grid()?.insertAdjacentHTML('afterbegin', cardHtml('other', 8));
    moved();
    sort.sync(database, settings);
    expect(requests.count).toBe(2);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });

  it('asks again when more cards have come in since, for example by scrolling', () => {
    render({ more: true });
    const { sort, requests, loaded } = setup();
    on();
    sort.sync(database, settings);
    loaded(false);
    sort.sync(database, settings);
    grid()?.insertAdjacentHTML('afterbegin', cardHtml('twin', 9));
    sort.sync(database, settings);
    expect(requests.count).toBe(2);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });

  it('does not ask again when the page says it has everything but the grid still shows more, and no card came in', () => {
    render({ more: true });
    const { sort, requests, loaded } = setup();
    on();
    sort.sync(database, settings);
    loaded(true);
    sort.sync(database, settings);
    expect(requests.count).toBe(1);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('partial');
  });

  it('shows what it has, and does not ask again, when the load failed after cards had come in', () => {
    render({ more: true });
    const { sort, requests, loaded } = setup();
    on();
    sort.sync(database, settings);
    grid()?.insertAdjacentHTML('afterbegin', cardHtml('twin', 9));
    loaded(false);
    sort.sync(database, settings);
    expect(requests.count).toBe(1);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('partial');
  });

  it('asks again when the page says it has everything, the grid still shows more, and cards had come in', () => {
    render({ more: true });
    const { sort, requests, loaded } = setup();
    on();
    sort.sync(database, settings);
    grid()?.insertAdjacentHTML('afterbegin', cardHtml('twin', 9));
    loaded(true);
    sort.sync(database, settings);
    expect(requests.count).toBe(2);
  });

  it('takes the hint off the button when the list is complete after all, and when the mode ends', () => {
    render({ more: true });
    const { sort, loaded } = setup();
    on();
    sort.sync(database, settings);
    loaded(false);
    sort.sync(database, settings);
    expect(document.querySelector('#sort-trigger')?.hasAttribute('title')).toBe(true);
    grid()?.lastElementChild?.remove();
    sort.sync(database, settings);
    expect(label()).toBe('По цене');
    expect(document.querySelector('#sort-trigger')?.hasAttribute('title')).toBe(false);
    render({ more: true });
    on();
    sort.sync(database, settings);
    loaded(false);
    sort.sync(database, settings);
    filters()?.removeAttribute('data-senkutools-sort');
    sort.sync(database, settings);
    expect(document.querySelector('#sort-trigger')?.hasAttribute('title')).toBe(false);
  });

  it('asks again when the price is chosen once more', () => {
    render({ more: true, menu: true });
    const { sort, requests, loaded, choose } = setup();
    sort.sync(database, settings);
    choose();
    sort.sync(database, settings);
    loaded(false);
    sort.sync(database, settings);
    choose();
    sort.sync(database, settings);
    expect(requests.count).toBe(2);
  });

  it('tells a new list from the one it already tried by its cards, not by how many there are', () => {
    render({ slugs: ['mid', 'dear', 'cheap'], more: true });
    const { sort, requests, loaded } = setup();
    on();
    sort.sync(database, settings);
    loaded(false);
    sort.sync(database, settings);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('partial');
    for (const slugs of [
      ['dear', 'twin', 'cheap'],
      ['dear', 'mid', 'twin'],
    ]) {
      render({ slugs, more: true });
      on();
      sort.sync(database, settings);
      expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
      loaded(false);
    }
    expect(requests.count).toBe(3);
  });

  it('asks for the new list when the site switches to another one, and stops dimming when the label comes back', () => {
    render({ more: true });
    const { sort, requests, loaded } = setup();
    on();
    sort.sync(database, settings);
    loaded(true);
    render({ slugs: ['mid', 'cheap'], more: true });
    on();
    sort.sync(database, settings);
    expect(requests.count).toBe(2);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });

  it('gives up waiting when nothing arrives for a long time, and waits on while cards keep coming', () => {
    render({ more: true });
    const { sort, timers, requests } = setup();
    on();
    sort.sync(database, settings);
    expect(timers).toHaveLength(1);
    grid()?.insertAdjacentHTML('afterbegin', cardHtml('twin', 9));
    timers.shift()?.();
    expect(timers).toHaveLength(1);
    sort.sync(database, settings);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
    timers.shift()?.();
    sort.sync(database, settings);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('partial');
    expect(requests.count).toBe(1);
  });

  it('does not mind a late timer once the answer has come', () => {
    render({ more: true });
    const { sort, timers, loaded, host } = setup();
    on();
    sort.sync(database, settings);
    loaded(true);
    const before = vi.mocked(host.schedule).mock.calls.length;
    timers.shift()?.();
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before);
  });
});

describe('the answer of the page', () => {
  it('asks for a redraw, so the grid is looked at again', () => {
    render({ more: true });
    const { sort, host, loaded } = setup();
    on();
    sort.sync(database, settings);
    const before = vi.mocked(host.schedule).mock.calls.length;
    loaded(true);
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before + 1);
  });

  it('is ignored when it is not one', () => {
    render({ more: true });
    const { sort, host } = setup();
    on();
    sort.sync(database, settings);
    const before = vi.mocked(host.schedule).mock.calls.length;
    sort.handleLoaded(new CustomEvent(LIST_LOADED_EVENT, { detail: 'nonsense' }));
    sort.handleLoaded(new CustomEvent(LIST_LOADED_EVENT));
    expect(vi.mocked(host.schedule).mock.calls.length).toBe(before);
    expect(grid()?.getAttribute('data-senkutools-sort-state')).toBe('loading');
  });
});

describe('touchesSort', () => {
  const record = (target: Node, added: Node[] = []): MutationRecord => ({ target, addedNodes: added as unknown as NodeList }) as MutationRecord;

  it('notices changes in the grid, the bar, and the sort menu, and a menu that is added', () => {
    render({ menu: true });
    expect(touchesSort([record(document.querySelector('.user-cards-grid')!)])).toBe(true);
    expect(touchesSort([record(document.querySelector('.user-card__filters button')!)])).toBe(true);
    expect(touchesSort([record(document.querySelector('#cards-browse-order .dropdown-menu')!)])).toBe(true);
    expect(touchesSort([record(document.querySelector('.user-card span, .radio__label span')!.firstChild ?? document.body)])).toBe(true);
    const popper = document.querySelector('#cards-browse-order')!;
    expect(touchesSort([record(document.body, [popper])])).toBe(true);
    const wrapper = document.createElement('div');
    wrapper.append(popper.cloneNode(true));
    expect(touchesSort([record(document.body, [wrapper])])).toBe(true);
  });

  it('does not notice the rest of the page', () => {
    render({ menu: true });
    const other = document.createElement('p');
    document.body.append(other);
    expect(touchesSort([record(other, [document.createElement('span'), document.createTextNode('x')])])).toBe(false);
    expect(touchesSort([record(document.createTextNode('x'))])).toBe(false);
    expect(touchesSort([])).toBe(false);
  });
});
