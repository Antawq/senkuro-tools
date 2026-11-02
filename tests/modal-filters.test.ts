import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../utils/shared/database';
import { SITE_LOCK_PATH, type LockView } from '../utils/trades/lock-filter';
import { createModalFiltersWatcher, isFilterMutation, syncModalFilters } from '../utils/trades/modal-filters';
import { createModalRefreshWatcher, isModalMutation, syncModalRefreshButtons } from '../utils/trades/modal-refresh';
import { isPickerMutation, updateShardSwitches } from '../utils/trades/shard-switch';
import { isTradeMutation } from '../utils/trades/trade-summary';
import { syncRangeControl } from '../utils/sort/range-control';
import { installIntersectionObservers } from './helpers/intersection-observer';

const read = (name: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../assets/${name}`), 'utf8');
const stylesheet = ['modal-filters.css', 'shard-switch.css'].map(read).join('\n');

const database: Database = {
  'wh-felicity-f': { price: 1.5, name: 'Фелисити', rank: 'F', manga: 'Охотник на ведьм' },
  'tek-yulnia-f': { price: 1.25, name: 'Юльния', rank: 'F', manga: 'Рыцарь огня' },
  'ych-elka-s': { price: 9, name: 'Ёлка', rank: 'S', manga: 'Зимняя сказка' },
};

interface RowSpec {
  slug: string;
  shownName: string;
  isLocked?: boolean;
  isShard?: boolean;
}

const ROWS: RowSpec[] = [
  { slug: 'wh-felicity-f', shownName: 'Фелисити', isLocked: true },
  { slug: 'tek-yulnia-f', shownName: 'Юльния' },
  { slug: 'ych-elka-s', shownName: 'Ёлка', isLocked: true, isShard: true },
  { slug: 'new-card-x', shownName: 'Новая карта' },
];

const rowHtml = ({ slug, shownName, isLocked = false, isShard = false }: RowSpec) =>
  `<div class="card-collect-preview${isShard ? ' card-collect-preview--shard' : ''}" data-id="${slug}">
    <div class="card-collect-preview__status"><span class="tag">3 карты${isLocked ? `<svg><path d="${SITE_LOCK_PATH}"></path></svg>` : ''}</span></div>
    <div class="card-collect-preview__front"><a class="card-collect" href="/cards/${slug}"><div class="card-collect__front"><img class="card-collect__img" alt="${shownName}"></div></a></div>
  </div>`;

const STEPS = {
  partner: ['Выбор карточек', ' Выбери до 50 карт, которые хочешь от'],
  own: ['Твои карточки', ' Выбери до 50 карт, которые готов отдать взамен'],
  catalog: ['Выбор карт из общего каталога', ' Выбери до 50 карт, которые хочешь от'],
} as const;

const windowHtml = (step: keyof typeof STEPS = 'partner', rows: RowSpec[] = ROWS, hasSentinel = false) => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header"><div class="modal-trade__header-headline"><h4 class="caption">${STEPS[step][0]}</h4><div class="modal-trade__header-hint">${STEPS[step][1]}</div></div></header>
    <div class="modal-trade__body scrollbar">
      <div class="modal-trade__header-form"><div class="v-popper"><button id="sort" type="button">Сортировка</button></div><button id="direction" type="button">Сначала</button></div>
      <div class="modal-trade__body-result">${rows.map(rowHtml).join('')}${hasSentinel ? '<div class="sentinel"></div>' : ''}</div>
    </div>
  </div>`;

let currentDatabase: Database = database;
const sync = () => syncModalFilters(document, () => currentDatabase);

const show = (step: keyof typeof STEPS = 'partner', rows: RowSpec[] = ROWS, hasSentinel = false) => {
  document.body.innerHTML = windowHtml(step, rows, hasSentinel);
  sync();
};

const toolbar = () => document.querySelector('.modal-trade__header-form') as HTMLElement;
const picker = () => document.querySelector('.modal-trade__body') as HTMLElement;
const results = () => document.querySelector('.modal-trade__body-result') as HTMLElement;
const lockTrigger = () => document.querySelector<HTMLButtonElement>('.senkutools-lock-filter__trigger');
const searchTrigger = () => document.querySelector<HTMLButtonElement>('.senkutools-modal-search__trigger');
const searchInput = () => document.querySelector<HTMLInputElement>('.senkutools-modal-search__input');
const note = () => document.querySelector<HTMLElement>('.senkutools-modal-filters__empty');
const rows = () => [...document.querySelectorAll<HTMLElement>('.card-collect-preview')];
const hiddenIds = () =>
  rows()
    .filter((row) => row.hasAttribute('data-senkutools-filtered'))
    .map((row) => row.dataset.id);
const shownIds = () =>
  rows()
    .filter((row) => !row.hasAttribute('data-senkutools-filtered'))
    .map((row) => row.dataset.id);
const displayOf = (id: string) => getComputedStyle(document.querySelector(`[data-id="${id}"]`) as Element).display;

const setStep = (step: keyof typeof STEPS) => {
  (document.querySelector('.modal-trade__header .caption') as Element).textContent = STEPS[step][0];
  (document.querySelector('.modal-trade__header-hint') as Element).textContent = STEPS[step][1];
  sync();
};

const chooseLock = (view: LockView) => {
  const radio = [...document.querySelectorAll<HTMLInputElement>('.senkutools-lock-filter__panel input')].find((candidate) => candidate.value === view);
  if (radio) radio.checked = true;
  radio?.dispatchEvent(new Event('change', { bubbles: true }));
};

const type = (text: string) => {
  searchTrigger()?.click();
  const field = searchInput();
  if (!field) return;
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

let observers: ReturnType<typeof installIntersectionObservers>;

beforeEach(() => {
  currentDatabase = database;
  observers = installIntersectionObservers();
  document.head.innerHTML = `<style>${stylesheet}</style>`;
  document.body.innerHTML = '';
});

afterEach(() => vi.unstubAllGlobals());

describe('the controls of a trade window', () => {
  it('draws the lock control and the search control on the partner step, in that order, last in the toolbar', () => {
    show('partner');
    expect([...toolbar().children].map((child) => child.className)).toEqual(['v-popper', '', 'senkutools-lock-filter', 'senkutools-modal-search']);
  });

  it('draws only the search control on the own cards step, where the site shows no lock', () => {
    show('own');
    expect(lockTrigger()).toBeNull();
    expect(searchTrigger()).not.toBeNull();
  });

  it('draws neither on the catalog step', () => {
    show('catalog');
    expect(lockTrigger()).toBeNull();
    expect(searchTrigger()).toBeNull();
  });

  it('draws neither when the header is reworded, so a changed site shows no lock control rather than a wrong one', () => {
    document.body.innerHTML = windowHtml('partner').replace('Выбор карточек', 'Выбери карточки');
    sync();
    expect(lockTrigger()).toBeNull();
    expect(searchTrigger()).not.toBeNull();
  });

  it('takes both away when the window moves to the catalog step and brings them back with the choice kept', () => {
    show('partner');
    chooseLock('locked');
    type('фелисити');
    setStep('catalog');
    expect(lockTrigger()).toBeNull();
    expect(searchTrigger()).toBeNull();
    expect(hiddenIds()).toEqual([]);
    setStep('partner');
    expect(lockTrigger()?.classList.contains('button--chip')).toBe(true);
    expect(searchInput()?.value).toBe('фелисити');
    expect(shownIds()).toEqual(['wh-felicity-f']);
  });

  it('keeps each window to its own choice', () => {
    document.body.innerHTML = windowHtml('partner') + windowHtml('partner');
    sync();
    const [first, second] = [...document.querySelectorAll('.modal-content--trade')];
    const radio = first?.querySelector<HTMLInputElement>('.senkutools-lock-filter__panel input[value="locked"]');
    if (radio) radio.checked = true;
    radio?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(first?.querySelectorAll('[data-senkutools-filtered]').length).toBe(2);
    expect(second?.querySelectorAll('[data-senkutools-filtered]').length).toBe(0);
  });
});

describe('the lock view on the partner step', () => {
  it('hides the locked rows on Без замка and the others on С замком, and shows all again on Все карты', () => {
    show('partner');
    expect(hiddenIds()).toEqual([]);
    chooseLock('unlocked');
    expect(hiddenIds()).toEqual(['wh-felicity-f', 'ych-elka-s']);
    chooseLock('locked');
    expect(hiddenIds()).toEqual(['tek-yulnia-f', 'new-card-x']);
    chooseLock('all');
    expect(hiddenIds()).toEqual([]);
  });

  it('really hides them with CSS, and never the element the site watches to load the next page', () => {
    show('partner', ROWS, true);
    chooseLock('unlocked');
    expect(displayOf('wh-felicity-f')).toBe('none');
    expect(displayOf('tek-yulnia-f')).not.toBe('none');
    expect(getComputedStyle(document.querySelector('.sentinel') as Element).display).not.toBe('none');
  });

  it('leaves the rows alone on the own cards step even after a lock view was chosen on the partner step', () => {
    show('partner');
    chooseLock('locked');
    expect(hiddenIds()).toHaveLength(2);
    setStep('own');
    expect(hiddenIds()).toEqual([]);
    setStep('partner');
    expect(hiddenIds()).toHaveLength(2);
  });

  it('judges rows that arrive later at the next sync', () => {
    show('partner', ROWS.slice(0, 2), true);
    chooseLock('unlocked');
    results().insertAdjacentHTML('afterbegin', rowHtml({ slug: 'late-card-d', shownName: 'Поздняя', isLocked: true }));
    sync();
    expect(hiddenIds()).toEqual(['late-card-d', 'wh-felicity-f']);
  });
});

describe('the search on a user cards step', () => {
  it('hides the rows that do not match as the text is typed and shows them all when it is cleared', () => {
    show('own');
    type('Ёлка');
    expect(shownIds()).toEqual(['ych-elka-s']);
    type('юльния');
    expect(shownIds()).toEqual(['tek-yulnia-f']);
    type('');
    expect(hiddenIds()).toEqual([]);
  });

  it('matches a card the database lacks by the name the site shows', () => {
    show('own');
    type('новая');
    expect(shownIds()).toEqual(['new-card-x']);
  });

  it('never matches the quantity text of a row', () => {
    show('own');
    type('карты');
    expect(shownIds()).toEqual([]);
  });

  it('reads the database at the moment of the sync, so a database that arrives after the window uses it', () => {
    currentDatabase = {};
    show('own');
    type('ведьм');
    expect(shownIds()).toEqual([]);
    currentDatabase = database;
    sync();
    expect(shownIds()).toEqual(['wh-felicity-f']);
  });

  it('is cleared by the first Escape and closed by the second', () => {
    show('own');
    type('Ёлка');
    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    searchInput()?.dispatchEvent(first);
    expect(hiddenIds()).toEqual([]);
    expect(searchInput()?.value).toBe('');
    expect((document.querySelector('.senkutools-modal-search__box') as HTMLElement).hidden).toBe(false);
    searchInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect((document.querySelector('.senkutools-modal-search__box') as HTMLElement).hidden).toBe(true);
    expect(document.activeElement).toBe(searchTrigger());
  });

  it('keeps the open field and the text when the site draws the toolbar and the list again', () => {
    show('own');
    type('Ёлка');
    toolbar().replaceChildren(...toolbar().children);
    sync();
    expect(searchInput()?.value).toBe('Ёлка');
    expect(shownIds()).toEqual(['ych-elka-s']);
  });
});

describe('both filters at once', () => {
  it('keeps only the rows that pass both', () => {
    show('partner');
    chooseLock('unlocked');
    type('ю');
    expect(shownIds()).toEqual(['tek-yulnia-f']);
    chooseLock('locked');
    expect(shownIds()).toEqual([]);
  });
});

describe('the note of an empty list', () => {
  it('shows after the list has been fully loaded and every row is hidden, with the text of the lock view', () => {
    show('partner', [ROWS[0] as RowSpec, ROWS[2] as RowSpec]);
    chooseLock('unlocked');
    expect(note()?.textContent).toBe('Нет доступных карт (все заблокированы)');
    expect(results().nextElementSibling).toBe(note());
    chooseLock('locked');
    expect(note()).toBeNull();
  });

  it('says there is no locked card when no row is locked', () => {
    show('partner', [ROWS[1] as RowSpec, ROWS[3] as RowSpec]);
    chooseLock('locked');
    expect(note()?.textContent).toBe('Нет заблокированных карт');
  });

  it('says that no character was found for a text that matches nothing', () => {
    show('own');
    type('наруто');
    expect(note()?.textContent).toBe('Персонаж не найден');
    type('');
    expect(note()).toBeNull();
  });

  it('gives one note, the search one, when the two filters together hide every row', () => {
    show('partner');
    chooseLock('unlocked');
    type('фелисити');
    expect(document.querySelectorAll('.senkutools-modal-filters__empty')).toHaveLength(1);
    expect(note()?.textContent).toBe('Персонаж не найден');
  });

  it('waits while the site has pages left, since a later page may hold a match', () => {
    show('own', ROWS, true);
    type('наруто');
    expect(note()).toBeNull();
    document.querySelector('.sentinel')?.remove();
    sync();
    expect(note()?.textContent).toBe('Персонаж не найден');
  });

  it('is not shown for a list that has no rows at all', () => {
    show('own', []);
    type('наруто');
    expect(note()).toBeNull();
  });

  it('counts the rows the shard switch hides, so the cards view with every card filtered out shows it', () => {
    show('partner', [ROWS[0] as RowSpec, ROWS[2] as RowSpec]);
    chooseLock('locked');
    expect(note()).toBeNull();
    picker().setAttribute('data-senkutools-shard-view', 'cards');
    sync();
    expect(note()).toBeNull();
    chooseLock('unlocked');
    expect(note()).not.toBeNull();
  });

  it('stays out of the way of the note of the shard switch', () => {
    show('partner', [ROWS[2] as RowSpec]);
    picker().setAttribute('data-senkutools-shard-view', 'cards');
    picker().insertAdjacentHTML('afterbegin', '<div class="senkutools-shard-switch__empty">Нет карт</div>');
    chooseLock('unlocked');
    expect(note()).toBeNull();
  });
});

describe('the note when the picture changes', () => {
  it('changes its text when the reason changes, and stays one note', () => {
    show('partner', [ROWS[0] as RowSpec]);
    chooseLock('unlocked');
    expect(note()?.textContent).toBe('Нет доступных карт (все заблокированы)');
    const first = note();
    type('наруто');
    expect(document.querySelectorAll('.senkutools-modal-filters__empty')).toHaveLength(1);
    expect(note()).toBe(first);
    expect(note()?.textContent).toBe('Персонаж не найден');
  });

  it('follows the list when the site draws it anew', () => {
    show('partner', [ROWS[0] as RowSpec]);
    chooseLock('unlocked');
    results().remove();
    picker().insertAdjacentHTML('beforeend', `<div class="modal-trade__body-result">${rowHtml(ROWS[2] as RowSpec)}</div>`);
    sync();
    expect(results().nextElementSibling).toBe(note());
    expect(document.querySelectorAll('.senkutools-modal-filters__empty')).toHaveLength(1);
  });

  it('is taken away with the list on a step that has none', () => {
    show('partner', [ROWS[0] as RowSpec]);
    chooseLock('unlocked');
    results().remove();
    sync();
    expect(note()).toBeNull();
  });

  it('counts the cards the shards view hides, as it counts the shards the cards view hides', () => {
    show('partner', [ROWS[1] as RowSpec, ROWS[2] as RowSpec]);
    picker().setAttribute('data-senkutools-shard-view', 'shards');
    chooseLock('unlocked');
    expect(note()?.textContent).toBe('Нет доступных карт (все заблокированы)');
    picker().setAttribute('data-senkutools-shard-view', 'cards');
    chooseLock('locked');
    expect(note()?.textContent).toBe('Нет заблокированных карт');
  });

  it('draws nothing in a window that has no body or no toolbar yet', () => {
    document.body.innerHTML = '<div class="modal-content modal-content--trade"><header class="modal-trade__header"></header></div>';
    sync();
    expect(document.querySelector('.senkutools-lock-filter, .senkutools-modal-search')).toBeNull();
    document.body.innerHTML = `<div class="modal-content modal-content--trade"><div class="modal-trade__body"><div class="modal-trade__body-result">${rowHtml(ROWS[0] as RowSpec)}</div></div></div>`;
    sync();
    expect(document.querySelector('.senkutools-lock-filter, .senkutools-modal-search')).toBeNull();
    expect(hiddenIds()).toEqual([]);
  });
});

describe('the paging of a filtered list', () => {
  it('asks the site for the next page again once rows are hidden, and not before', () => {
    show('partner', ROWS, true);
    expect(observers.observations).toHaveLength(0);
    chooseLock('unlocked');
    expect(observers.observations).toHaveLength(1);
    expect(observers.observations[0]?.targets).toEqual([document.querySelector('.sentinel')]);
    expect(observers.observations[0]?.options?.rootMargin).toBe('0px 0px 250px 0px');
  });

  it('does the same for a search, with no timer involved', () => {
    vi.useFakeTimers();
    show('own', ROWS, true);
    type('ёлка');
    expect(observers.observations).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('leaves the pager alone when no filter is on or the list is complete', () => {
    show('partner');
    chooseLock('unlocked');
    expect(observers.observations).toHaveLength(0);
  });
});

describe('the watcher', () => {
  const frames: (() => void)[] = [];
  const nextFrame = (run: () => void) => void frames.push(run);
  const record = (target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []) => ({ target, addedNodes, removedNodes }) as unknown as MutationRecord;

  beforeEach(() => {
    frames.length = 0;
  });

  it('syncs once per frame however many relevant mutations came, with the database it holds at that time', () => {
    document.body.innerHTML = windowHtml('own');
    const watcher = createModalFiltersWatcher({ nextFrame, getDatabase: () => currentDatabase });
    watcher.watch([record(results(), [document.createElement('div')]), record(results(), [document.createElement('div')])]);
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(searchTrigger()).not.toBeNull();
  });

  it('syncs on demand, as when the database has just loaded', () => {
    document.body.innerHTML = windowHtml('own');
    const watcher = createModalFiltersWatcher({ nextFrame, getDatabase: () => currentDatabase });
    watcher.sync();
    type('ведьм');
    currentDatabase = {};
    watcher.sync();
    expect(shownIds()).toEqual([]);
    currentDatabase = database;
    watcher.sync();
    expect(shownIds()).toEqual(['wh-felicity-f']);
  });

  it('resyncs on the attribute record of a shard view change, so the note follows the view with no other mutation', () => {
    show('own');
    type('такого нет');
    picker().setAttribute('data-senkutools-shard-view', 'cards');
    expect(isFilterMutation(record(picker(), []))).toBe(true);
  });

  it('ignores the controls and the note it draws itself, and the controls of the other features', () => {
    show('partner');
    chooseLock('unlocked');
    type('наруто');
    const own = [document.querySelector('.senkutools-lock-filter'), document.querySelector('.senkutools-modal-search'), note()] as Element[];
    for (const node of own) {
      expect(isFilterMutation(record(picker(), [node]))).toBe(false);
      expect(isFilterMutation(record(picker(), [], [node]))).toBe(false);
      expect(isFilterMutation(record(node, [document.createElement('span')]))).toBe(false);
    }
    expect(isFilterMutation(record(results(), [document.createElement('div')]))).toBe(true);
  });

  it('is not woken by a refresh button or a price control either', () => {
    show('partner');
    for (const className of ['senkutools-modal-refresh', 'senkutools-price-filter', 'senkutools-price-filter__empty']) {
      const node = document.createElement('div');
      node.className = className;
      expect(isFilterMutation(record(toolbar(), [node]))).toBe(false);
    }
  });
});

describe('the other watchers of the window', () => {
  const record = (target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []) => ({ target, addedNodes, removedNodes }) as unknown as MutationRecord;

  it.each([
    ['the lock control', '.senkutools-lock-filter'],
    ['the search control', '.senkutools-modal-search'],
    ['the empty note', '.senkutools-modal-filters__empty'],
  ])('ignore %s being added, removed or changed', (_name, selector) => {
    show('partner');
    chooseLock('unlocked');
    type('наруто');
    const node = document.querySelector(selector) as Element;
    const parent = node.parentElement as Element;
    for (const isRelevant of [isPickerMutation, isModalMutation, isTradeMutation]) {
      expect(isRelevant(record(parent, [node]))).toBe(false);
      expect(isRelevant(record(parent, [], [node]))).toBe(false);
      expect(isRelevant(record(node, [document.createElement('span')]))).toBe(false);
    }
  });
});

describe('every toolbar sync together', () => {
  const view = { label: 'Цена', range: null };
  const refreshHost = { isReady: () => true, refresh: () => Promise.resolve('done' as const), nextFrame: (run: () => void) => run() };

  const syncEverything = () => {
    updateShardSwitches();
    syncRangeControl(toolbar(), 'modal-trade__header-form__mob', view, () => undefined);
    syncModalRefreshButtons(refreshHost);
    sync();
  };

  it.each(['partner', 'own'] as const)('add nothing and move nothing on the second pass on the %s step, with a filter on', (step) => {
    document.body.innerHTML = windowHtml(step, ROWS, true);
    syncEverything();
    chooseLock(step === 'partner' ? 'unlocked' : 'all');
    type('новая');
    syncEverything();
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    syncEverything();
    syncEverything();
    expect(observer.takeRecords().map((entry) => [entry.type, (entry.target as Element).className])).toEqual([]);
    observer.disconnect();
  });

  it('leave the observed shard view attribute unwritten on a pass that does not change it', () => {
    document.body.innerHTML = windowHtml('partner');
    updateShardSwitches();
    [...document.querySelectorAll<HTMLButtonElement>('.senkutools-shard-switch__button')].find((button) => button.textContent === 'Карты')?.click();
    const observer = new MutationObserver(() => undefined);
    observer.observe(picker(), { attributeFilter: ['data-senkutools-shard-view'] });
    syncEverything();
    expect(picker().getAttribute('data-senkutools-shard-view')).toBe('cards');
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('settle on one order of the controls whichever of them the toolbar met first', () => {
    document.body.innerHTML = windowHtml('partner');
    syncModalRefreshButtons(refreshHost);
    sync();
    syncRangeControl(toolbar(), null, view, () => undefined);
    updateShardSwitches();
    expect([...toolbar().children].map((child) => [...child.classList].find((name) => name.startsWith('senkutools-')) ?? '')).toEqual([
      '',
      '',
      'senkutools-price-filter',
      'senkutools-lock-filter',
      'senkutools-modal-search',
      'senkutools-modal-refresh',
    ]);
  });

  it('keep the refresh button last when the window asks for it again after the controls were drawn', () => {
    document.body.innerHTML = windowHtml('partner');
    sync();
    const watcher = createModalRefreshWatcher(refreshHost);
    watcher.watch([{ target: toolbar(), addedNodes: [document.createElement('div')], removedNodes: [] } as unknown as MutationRecord]);
    expect(toolbar().lastElementChild?.classList.contains('senkutools-modal-refresh')).toBe(true);
    sync();
    expect(toolbar().lastElementChild?.classList.contains('senkutools-modal-refresh')).toBe(true);
    expect(document.querySelector('.senkutools-modal-search')?.nextElementSibling?.classList.contains('senkutools-modal-refresh')).toBe(true);
  });
});
