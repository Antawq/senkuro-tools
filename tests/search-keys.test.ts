import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSearchKeys, type SearchKeys } from '../utils/search/search-keys';
import { createSearchSignals, type SearchSignals } from '../utils/search/search-signal';

const ACTIVE_ROW_CLASS = 'card-search--active';

const row = (index: number, slug: string) => `<a class="card-search" data-index="${index}" href="/manga/${slug}">${slug}</a>`;

const rowsOf = (...slugs: string[]) => slugs.map((slug, index) => row(index, slug)).join('');

const modalHtml = (slugs: string[], query: string) => `
  <div class="modal-container vfm">
    <div class="vfm__content modal-content modal-content--search">
      <input class="input-el" value="${query}">
      <button class="close">x</button>
      <div class="nav-search__cnt">${rowsOf(...slugs)}</div>
    </div>
  </div>`;

const open = (slugs: string[], query = 'naruto') => {
  document.body.innerHTML = modalHtml(slugs, query);
  watchClicks();
};

const ready = async (slugs: string[], query = 'naruto') => {
  open(slugs, '');
  typed(query);
  await settle(1000);
};

const input = () => document.querySelector<HTMLInputElement>('input.input-el') as HTMLInputElement;
const results = () => document.querySelector('.nav-search__cnt') as HTMLElement;
const rows = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-index]')];
const activeIndexes = () => rows().flatMap((element, index) => (element.classList.contains(ACTIVE_ROW_CLASS) ? [index] : []));

const clicked: string[] = [];
const clickKeys: string[] = [];
let siteSaw: string[];
let keys: SearchKeys;
let detach: (() => void)[];
let isContextAlive: boolean;
let signals: SearchSignals;

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = input()) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const typed = (text: string) => {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
};

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function watchClicks() {
  for (const element of rows()) {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      clicked.push(element.getAttribute('href') ?? '');
      clickKeys.push(`${event.ctrlKey ? 'ctrl' : ''}${event.metaKey ? 'meta' : ''}`);
    });
  }
}

const arrive = async (...slugs: string[]) => {
  results().innerHTML = rowsOf(...slugs);
  watchClicks();
  await settle();
};

const listen = (type: string, handler: (event: never) => void, options?: AddEventListenerOptions) => {
  document.addEventListener(type, handler as EventListener, options);
  detach.push(() => document.removeEventListener(type, handler as EventListener, options));
};

beforeEach(() => {
  vi.useFakeTimers();
  clicked.length = 0;
  clickKeys.length = 0;
  siteSaw = [];
  detach = [];
  isContextAlive = true;
  signals = createSearchSignals();
  keys = createSearchKeys(document, { runAfter: (run, delayMs) => void setTimeout(run, delayMs), isContextValid: () => isContextAlive, signals });
  listen('keydown', keys.handleKeydown, { capture: true });
  listen('input', keys.handleInput, { capture: true });
  listen('keydown', (event: KeyboardEvent) => siteSaw.push(`site:${event.key}`));
});

afterEach(() => {
  keys.dispose();
  detach.forEach((remove) => remove());
  vi.useRealTimers();
});

describe('Enter', () => {
  it('opens the first result when nothing is highlighted, and the site never sees the key', async () => {
    await ready(['a', 'b', 'c']);
    const event = press('Enter');
    expect(clicked).toEqual(['/manga/a']);
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:Enter');
  });

  it('opens the highlighted result', async () => {
    await ready(['a', 'b', 'c']);
    press('ArrowDown');
    press('ArrowDown');
    press('Enter');
    expect(clicked).toEqual(['/manga/b']);
  });

  it('opens a result of any type, not only manga', async () => {
    document.body.innerHTML = `
      <div class="vfm"><div class="modal-content--search">
        <input class="input-el" value="">
        <div class="nav-search__cnt"><a class="card-search" data-index="0" href="/users/@1">chu</a></div>
      </div></div>`;
    watchClicks();
    typed('chu');
    await settle(1000);
    press('Enter');
    expect(clicked).toEqual(['/users/@1']);
  });

  it('opens the first result from the numeric keypad key too, which the site ignores', async () => {
    await ready(['a', 'b']);
    press('Enter', { code: 'NumpadEnter' });
    expect(clicked).toEqual(['/manga/a']);
  });

  it('waits for results that arrive after the debounce when it is pressed right after typing', async () => {
    open(['old-a', 'old-b']);
    typed('naruto');
    press('Enter');
    expect(clicked).toEqual([]);
    await settle(300);
    await arrive('new-a', 'new-b');
    expect(clicked).toEqual(['/manga/new-a']);
  });

  it('does not trust a response that lands before the debounce has fired, such as one for a partial query', async () => {
    open(['old-a']);
    typed('naruto');
    press('Enter');
    await settle(100);
    await arrive('partial-a');
    expect(clicked).toEqual([]);
    await settle(300);
    await arrive('final-a');
    expect(clicked).toEqual(['/manga/final-a']);
  });

  it('opens the shown results once they have had time to settle, even if they did not change', async () => {
    open(['a', 'b']);
    typed('naruto');
    press('Enter');
    await settle(2000);
    expect(clicked).toEqual(['/manga/a']);
  });

  it('waits for results when none are shown yet, and gives up quietly when none come', async () => {
    open([]);
    typed('naruto');
    press('Enter');
    await settle(5000);
    expect(clicked).toEqual([]);
    await arrive('late');
    await settle(1000);
    expect(clicked).toEqual([]);
  });

  it('gives up all the same when the clock reads a millisecond short at the give-up timer', async () => {
    open([]);
    typed('naruto');
    press('Enter');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2999);
    await settle(5000);
    await arrive('late');
    await settle(1000);
    expect(clicked).toEqual([]);
  });

  it('works again after a wait that gave up', async () => {
    open([]);
    typed('naruto');
    press('Enter');
    await settle(5000);
    await arrive('late');
    press('Enter');
    expect(clicked).toEqual(['/manga/late']);
  });

  it('runs once when it is pressed again during the wait', async () => {
    open([]);
    typed('naruto');
    press('Enter');
    press('Enter');
    await settle(300);
    await arrive('late');
    await settle(1500);
    expect(clicked).toEqual(['/manga/late']);
  });

  describe('a wait that was overtaken by the user', () => {
    const withTabs = () => {
      (document.querySelector('.modal-content--search') as HTMLElement).insertAdjacentHTML(
        'afterbegin',
        '<div class="tabs"><button class="tabs-tab tabs-tab--active">Манга</button><button class="tabs-tab">Аниме</button></div>'
      );
    };

    const switchTab = () => {
      const [first, second] = [...document.querySelectorAll('.tabs-tab')];
      first?.classList.remove('tabs-tab--active');
      second?.classList.add('tabs-tab--active');
    };

    it('does not open the results of a query edited after Enter was pressed', async () => {
      open([]);
      withTabs();
      typed('nartuo');
      press('Enter');
      await settle(300);
      typed('naruto');
      await arrive('a', 'b');
      await settle(3000);
      expect(clicked).toEqual([]);
    });

    it('does not open the results of a query changed without an input event, as by a chip', async () => {
      open([]);
      withTabs();
      typed('nartuo');
      press('Enter');
      await settle(300);
      input().value = 'naruto';
      await arrive('a', 'b');
      await settle(3000);
      expect(clicked).toEqual([]);
    });

    it('does not open the results of another tab switched to after Enter was pressed', async () => {
      open([]);
      withTabs();
      typed('nartuo');
      press('Enter');
      await settle(300);
      switchTab();
      await arrive('a', 'b');
      await settle(3000);
      expect(clicked).toEqual([]);
    });

    it('still opens the results that arrive for the query Enter was pressed on', async () => {
      open([]);
      withTabs();
      typed('naruto');
      press('Enter');
      await settle(300);
      await arrive('late');
      await settle(1500);
      expect(clicked).toEqual(['/manga/late']);
    });

    it('works again for the next Enter after the user moved on', async () => {
      open([]);
      withTabs();
      typed('nartuo');
      press('Enter');
      typed('naruto');
      await arrive('a', 'b');
      await settle(1000);
      press('Enter');
      expect(clicked).toEqual(['/manga/a']);
    });
  });

  it('does not click again while the modal fades out after a click', async () => {
    await ready(['a', 'b']);
    press('Enter');
    const second = press('Enter');
    expect(clicked).toEqual(['/manga/a']);
    expect(second.defaultPrevented).toBe(false);
  });

  it('stops waiting when the modal starts closing, so a late result is not opened', async () => {
    open([]);
    typed('naruto');
    press('Enter');
    document.querySelector('.vfm')?.classList.add('vfm--prevent-none');
    await settle(300);
    await arrive('late');
    await settle(3000);
    expect(clicked).toEqual([]);
  });

  it('treats a query changed without an input event, as by voice or a chip, as typing', async () => {
    open(['old-a']);
    input().value = 'bleach';
    press('Enter');
    expect(clicked).toEqual([]);
    await settle(300);
    await arrive('new-a');
    expect(clicked).toEqual(['/manga/new-a']);
  });

  it('opens nothing and keeps the key from the site when the field is empty, though old results are still shown', () => {
    open(['a', 'b'], '');
    const event = press('Enter');
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:Enter');
  });

  it('opens nothing for a one-letter query', async () => {
    open(['a'], 'n');
    press('Enter');
    await settle(5000);
    expect(clicked).toEqual([]);
  });

  it('works in the top modal when a second search was opened over the first', async () => {
    document.body.innerHTML = modalHtml(['under-a'], '') + modalHtml(['top-a'], '');
    watchClicks();
    const top = document.querySelectorAll<HTMLInputElement>('input.input-el')[1] as HTMLInputElement;
    top.value = 'bleach';
    top.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(1000);
    press('Enter', {}, top);
    expect(clicked).toEqual(['/manga/top-a']);
  });

  it.each([
    ['altKey', { altKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['ctrlKey and shiftKey', { ctrlKey: true, shiftKey: true }],
    ['metaKey and altKey', { metaKey: true, altKey: true }],
  ])('opens nothing and keeps the key from the site, which would jump to the catalog, with %s', (_name, init) => {
    open(['a']);
    const event = press('Enter', init);
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).not.toContain('site:Enter');
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['altKey', { altKey: true }],
    ['shiftKey', { shiftKey: true }],
  ])('keeps a modified arrow from the site so only one row is highlighted, with %s', async (_name, init) => {
    await ready(['a', 'b']);
    const event = press('ArrowDown', init);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).not.toContain('site:ArrowDown');
    expect(activeIndexes()).toEqual([]);
  });

  it('keeps a modified keypad Enter from the site too', () => {
    open(['a']);
    press('Enter', { code: 'NumpadEnter', ctrlKey: true });
    expect(siteSaw).not.toContain('site:Enter');
  });

  it('leaves a modified Enter outside the modal to the page', () => {
    open(['a']);
    document.body.insertAdjacentHTML('beforeend', '<div class="editor" contenteditable="true"></div>');
    press('Enter', { ctrlKey: true }, document.querySelector('.editor') as HTMLElement);
    expect(siteSaw).toContain('site:Enter');
  });

  it('leaves a modified Enter to the site when the search is not open', () => {
    document.body.innerHTML = '<input class="input-el" value="naruto">';
    press('Enter', { ctrlKey: true });
    expect(siteSaw).toContain('site:Enter');
  });

  it('is left alone when the search is not open', () => {
    document.body.innerHTML = '<input class="input-el" value="naruto">';
    const event = press('Enter');
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:Enter');
  });

  it('is left alone while the modal is closing', () => {
    open(['a']);
    document.querySelector('.vfm')?.classList.add('vfm--prevent-none');
    const event = press('Enter');
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:Enter');
  });

  it('keeps the key from the site but lets a focused button act on it', () => {
    open(['a']);
    const close = document.querySelector('.close') as HTMLElement;
    const event = press('Enter', {}, close);
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).not.toContain('site:Enter');
  });

  it('is left alone on a control outside the modal', () => {
    open(['a']);
    document.body.insertAdjacentHTML('beforeend', '<div class="editor" contenteditable="true"></div>');
    const event = press('Enter', {}, document.querySelector('.editor') as HTMLElement);
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:Enter');
  });

  it('does nothing once the extension has been unloaded', () => {
    open(['a']);
    isContextAlive = false;
    const event = press('Enter');
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('Ctrl or Meta+Enter', () => {
  it.each([
    ['ctrlKey', { ctrlKey: true }, 'ctrl'],
    ['metaKey', { metaKey: true }, 'meta'],
  ])('opens the first result as a new tab click with %s, leaving the search open', async (_name, init, expected) => {
    await ready(['a', 'b']);
    const event = press('Enter', init);
    expect(clicked).toEqual(['/manga/a']);
    expect(clickKeys).toEqual([expected]);
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:Enter');
    press('Enter');
    expect(clicked).toEqual(['/manga/a', '/manga/a']);
    expect(clickKeys).toEqual([expected, '']);
  });

  it('opens the highlighted result', async () => {
    await ready(['a', 'b', 'c']);
    press('ArrowDown');
    press('ArrowDown');
    press('Enter', { ctrlKey: true });
    expect(clicked).toEqual(['/manga/b']);
  });

  it('works from the numeric keypad key too', async () => {
    await ready(['a']);
    press('Enter', { code: 'NumpadEnter', ctrlKey: true });
    expect(clicked).toEqual(['/manga/a']);
    expect(clickKeys).toEqual(['ctrl']);
  });

  it('waits for the results of what was just typed, like Enter does', async () => {
    open(['old-a']);
    typed('naruto');
    press('Enter', { ctrlKey: true });
    expect(clicked).toEqual([]);
    await arrive('new-a');
    await settle(1000);
    expect(clicked).toEqual(['/manga/new-a']);
    expect(clickKeys).toEqual(['ctrl']);
  });

  it('opens nothing for a query under two letters', async () => {
    await ready(['a'], 'n');
    press('Enter', { ctrlKey: true });
    expect(clicked).toEqual([]);
  });

  it('is left to the input method inside a composition, as Enter is', async () => {
    await ready(['a']);
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
    input().dispatchEvent(event);
    expect(clicked).toEqual([]);
  });

  it('keeps the key from the site on a focused button, which acts on it itself', () => {
    open(['a']);
    press('Enter', { ctrlKey: true }, document.querySelector('.close') as HTMLElement);
    expect(clicked).toEqual([]);
    expect(siteSaw).not.toContain('site:Enter');
  });

  it('does nothing once the extension has been unloaded', async () => {
    await ready(['a']);
    isContextAlive = false;
    press('Enter', { ctrlKey: true });
    expect(clicked).toEqual([]);
    expect(siteSaw).toContain('site:Enter');
  });
});

describe('the slash key', () => {
  let opened = 0;

  const page = (extra = '') => {
    document.body.innerHTML = `<header><button class="nav-search__btn">Поиск</button></header><main>${extra}</main>`;
    opened = 0;
    document.querySelector('.nav-search__btn')?.addEventListener('click', () => (opened += 1));
  };

  const slash = (init: KeyboardEventInit = {}, target: EventTarget = document.body) => press('/', init, target);

  it('opens the search from the header button and keeps the slash out of the page', () => {
    page();
    const event = slash();
    expect(opened).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:/');
  });

  it('works with shift, as a layout that types the slash that way needs', () => {
    page();
    slash({ shiftKey: true });
    expect(opened).toBe(1);
  });

  it.each([
    ['an input', '<input id="f">'],
    ['a textarea', '<textarea id="f"></textarea>'],
    ['a select', '<select id="f"><option>a</option></select>'],
    ['an editable element', '<div id="f" contenteditable="true"></div>'],
  ])('is left to the page while typing in %s', (_name, markup) => {
    page(markup);
    const event = slash({}, document.getElementById('f') as HTMLElement);
    expect(opened).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:/');
  });

  it('opens from a focused non-editable element such as a link', () => {
    page('<a id="f" href="/x">x</a>');
    slash({}, document.getElementById('f') as HTMLElement);
    expect(opened).toBe(1);
  });

  it('is left alone while any modal is open, the search itself or another', () => {
    page('<div class="modal-content modal-content--trade"></div>');
    expect(slash().defaultPrevented).toBe(false);
    expect(opened).toBe(0);
    open(['a']);
    document.body.insertAdjacentHTML('beforeend', '<button class="nav-search__btn">x</button>');
    expect(slash().defaultPrevented).toBe(false);
  });

  it('is left alone on a page without the search button', () => {
    document.body.innerHTML = '<main></main>';
    const event = slash();
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:/');
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['altKey', { altKey: true }],
    ['a held key', { repeat: true }],
    ['a composition', { isComposing: true }],
  ])('is left alone with %s', (_name, init) => {
    page();
    slash(init);
    expect(opened).toBe(0);
  });

  it('does nothing once the extension has been unloaded', () => {
    page();
    isContextAlive = false;
    slash();
    expect(opened).toBe(0);
  });
});

describe('dispose', () => {
  it('takes its highlight off the page', async () => {
    await ready(['a', 'b']);
    press('ArrowDown');
    expect(activeIndexes()).toEqual([0]);
    keys.dispose();
    expect(activeIndexes()).toEqual([]);
  });
});

describe('arrows pressed before the results of what was typed have arrived', () => {
  it('apply to the new results, not to the ones they replace', async () => {
    open(['old-a', 'old-b', 'old-c']);
    typed('naruto');
    press('ArrowDown');
    press('ArrowDown');
    await arrive('new-a', 'new-b', 'new-c');
    await settle(1000);
    expect(activeIndexes()).toEqual([1]);
    press('Enter');
    expect(clicked).toEqual(['/manga/new-b']);
  });

  it('stay on the last row of a shorter new list', async () => {
    open(['old-a', 'old-b', 'old-c']);
    typed('naruto');
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    await arrive('new-a', 'new-b');
    await settle(1000);
    expect(activeIndexes()).toEqual([1]);
  });

  it('survive a moment with no rows between the two lists', async () => {
    open(['old-a', 'old-b', 'old-c']);
    typed('naruto');
    press('ArrowDown');
    press('ArrowDown');
    await arrive();
    await arrive('new-a', 'new-b', 'new-c');
    await settle(1000);
    expect(activeIndexes()).toEqual([1]);
  });

  it('are dropped when the query is typed again afterwards', async () => {
    open(['old-a', 'old-b', 'old-c']);
    typed('naruto');
    press('ArrowDown');
    typed('naruto 2');
    await arrive('new-a', 'new-b');
    await settle(1000);
    expect(activeIndexes()).toEqual([]);
  });

  it('are not carried over when the results had already settled', async () => {
    await ready(['a', 'b', 'c']);
    press('ArrowDown');
    press('ArrowDown');
    await arrive('x', 'y', 'z');
    expect(activeIndexes()).toEqual([]);
  });
});

describe('the highlighted row scrolling into view', () => {
  it('scrolls the nearest way and leaves the speed to the stylesheet', async () => {
    await ready(['a', 'b', 'c']);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    press('ArrowDown');
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
    scrolled.mockRestore();
  });
});

describe('arrows', () => {
  it.each(['ArrowDown', 'ArrowUp'])('highlights the first result on the first %s', (key) => {
    open(['a', 'b', 'c']);
    press(key);
    expect(activeIndexes()).toEqual([0]);
  });

  it('moves down and up and stops at the ends', () => {
    open(['a', 'b', 'c']);
    for (let i = 0; i < 5; i += 1) press('ArrowDown');
    expect(activeIndexes()).toEqual([2]);
    for (let i = 0; i < 5; i += 1) press('ArrowUp');
    expect(activeIndexes()).toEqual([0]);
  });

  it('takes the arrow from the site and from the caret, also with no results yet', () => {
    open(['a', 'b']);
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:ArrowDown');
    open([]);
    const empty = press('ArrowDown');
    expect(empty.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:ArrowDown');
  });

  it('forgets the highlight when the results change, so the next arrow starts at the top', async () => {
    open(['a', 'b', 'c', 'd', 'e', 'f']);
    for (let i = 0; i < 6; i += 1) press('ArrowDown');
    expect(activeIndexes()).toEqual([5]);
    typed('bleach');
    await arrive('x', 'y', 'z', 'w');
    press('ArrowDown');
    expect(activeIndexes()).toEqual([0]);
  });

  it('forgets the highlight when the results change without typing, as on a tab switch', async () => {
    await ready(['a', 'b', 'c', 'd', 'e', 'f']);
    for (let i = 0; i < 6; i += 1) press('ArrowDown');
    await arrive('x', 'y');
    press('ArrowDown');
    expect(activeIndexes()).toEqual([0]);
  });

  it('forgets the highlight when the same results are mounted again, as on switching tabs back', async () => {
    await ready(['a', 'b', 'c', 'd']);
    for (let i = 0; i < 3; i += 1) press('ArrowDown');
    await arrive('a', 'b', 'c', 'd');
    press('ArrowDown');
    expect(activeIndexes()).toEqual([0]);
  });

  it('starts over in a search that was opened again', async () => {
    await ready(['a', 'b', 'c']);
    press('ArrowDown');
    press('ArrowDown');
    await ready(['a', 'b', 'c']);
    press('Enter');
    expect(clicked).toEqual(['/manga/a']);
  });

  it('opens the first new result after the results changed under a highlight', async () => {
    open(['a', 'b', 'c', 'd', 'e', 'f']);
    for (let i = 0; i < 6; i += 1) press('ArrowDown');
    typed('bleach');
    await arrive('x', 'y');
    press('Enter');
    await settle(1000);
    expect(clicked).toEqual(['/manga/x']);
  });

  it('keeps the arrow from the site but lets a focused button act on it, so tabs keep moving', () => {
    open(['a']);
    const close = document.querySelector('.close') as HTMLElement;
    const event = press('ArrowDown', {}, close);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).not.toContain('site:ArrowDown');
    expect(activeIndexes()).toEqual([]);
  });
});

describe('with signals from the page', () => {
  const emit = (phase: 'start' | 'done', query: string, firstSlug: string | null = null) =>
    signals.handleEvent(
      new CustomEvent('senkutools:search', {
        detail: JSON.stringify(phase === 'done' ? { phase, query, type: 'MANGA', settled: true, firstSlug } : { phase, query, type: 'MANGA' }),
      })
    );

  const heardOnce = () => {
    emit('start', 'earlier');
    emit('done', 'earlier', 'old-a');
  };

  it('opens the first result only once the search for what was typed has come back and the page shows it', async () => {
    open(['old-a'], '');
    heardOnce();
    typed('naruto');
    press('Enter');
    await settle(210);
    emit('start', 'naruto');
    await settle(100);
    expect(clicked).toEqual([]);
    await arrive('final-a');
    expect(clicked).toEqual([]);
    emit('done', 'naruto', 'final-a');
    await settle(100);
    expect(clicked).toEqual(['/manga/final-a']);
  });

  it('waits for the page to draw an answer, however late, and never opens the rows of the answer before it', async () => {
    open(['old-a'], '');
    heardOnce();
    typed('naruto');
    press('Enter');
    await settle(210);
    emit('start', 'naruto');
    emit('done', 'naruto', 'new-a');
    await settle(1500);
    expect(clicked).toEqual([]);
    await arrive('new-a');
    expect(clicked).toEqual(['/manga/new-a']);
  });

  it('does not take the rows of an earlier query for the answer when the page is slow to start its search', async () => {
    open(['old-a'], '');
    heardOnce();
    typed('naruto');
    press('Enter');
    await settle(2000);
    expect(clicked).toEqual([]);
    emit('start', 'naruto');
    await arrive('final-a');
    emit('done', 'naruto', 'final-a');
    await settle(100);
    expect(clicked).toEqual(['/manga/final-a']);
  });

  it('is not taken in by the answer to a partial query that lands right after the last key', async () => {
    open(['old-a'], '');
    heardOnce();
    emit('start', 'naru');
    typed('naruto');
    press('Enter');
    await settle(100);
    await arrive('partial-a');
    emit('done', 'naru', 'partial-a');
    await settle(100);
    expect(clicked).toEqual([]);
    await settle(100);
    emit('start', 'naruto');
    await settle(200);
    await arrive('final-a');
    emit('done', 'naruto', 'final-a');
    await settle(100);
    expect(clicked).toEqual(['/manga/final-a']);
  });

  it('compares what was typed with what was searched without the spaces around it', () => {
    open(['a', 'b'], '');
    emit('start', 'naruto ');
    emit('done', 'naruto ', 'a');
    typed(' naruto');
    press('Enter');
    expect(clicked).toEqual(['/manga/a']);
  });

  it('opens what is shown at once when it is the answer to what was typed', () => {
    open(['a', 'b'], '');
    emit('start', 'naruto');
    emit('done', 'naruto', 'a');
    typed('naruto');
    press('Enter');
    expect(clicked).toEqual(['/manga/a']);
  });

  it('gives up quietly on a search that never answers', async () => {
    open(['a'], '');
    heardOnce();
    typed('naruto');
    press('Enter');
    await settle(210);
    emit('start', 'naruto');
    await settle(5000);
    expect(clicked).toEqual([]);
  });

  it('opens nothing for an answer that found nothing', async () => {
    open(['old-a'], '');
    heardOnce();
    typed('zzzz');
    press('Enter');
    await settle(210);
    emit('start', 'zzzz');
    await arrive();
    emit('done', 'zzzz', null);
    await settle(5000);
    expect(clicked).toEqual([]);
  });

  it('falls back to the timing it has without signals when the page never speaks', async () => {
    open(['a', 'b'], '');
    typed('naruto');
    press('Enter');
    await settle(2000);
    expect(clicked).toEqual(['/manga/a']);
  });
});

describe('while an input method is composing', () => {
  const composing = (key: string, init: KeyboardEventInit & { keyCode?: number } = {}, target: EventTarget = input()) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
    target.dispatchEvent(event);
    return event;
  };

  it.each([
    ['isComposing', 'Enter', { code: 'Enter', isComposing: true }],
    ['a keyCode of 229 only', 'Enter', { code: 'Enter', keyCode: 229 }],
    ['the Process key', 'Process', { code: 'Enter', isComposing: true, keyCode: 229 }],
    ['the keypad Enter', 'Enter', { code: 'NumpadEnter', isComposing: true }],
  ])('keeps Enter from the site and opens nothing, as seen by %s', async (_name, key, init) => {
    await ready(['a', 'b']);
    const event = composing(key, init);
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).not.toContain(`site:${key}`);
  });

  it('keeps the arrows from the site but leaves them to the input method', async () => {
    await ready(['a', 'b']);
    const event = composing('ArrowDown', { code: 'ArrowDown', isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).not.toContain('site:ArrowDown');
    expect(activeIndexes()).toEqual([]);
  });

  it('does not touch the other keys of a composition', async () => {
    await ready(['a']);
    composing('Process', { code: 'KeyA', isComposing: true, keyCode: 229 });
    expect(siteSaw).toContain('site:Process');
  });

  it('leaves a composition outside the modal to the page', () => {
    open(['a']);
    document.body.insertAdjacentHTML('beforeend', '<div class="editor" contenteditable="true"></div>');
    composing('Enter', { code: 'Enter', isComposing: true }, document.querySelector('.editor') as HTMLElement);
    expect(siteSaw).toContain('site:Enter');
  });

  it('leaves it alone when no search is open', () => {
    document.body.innerHTML = '<input class="input-el" value="naruto">';
    composing('Enter', { code: 'Enter', isComposing: true }, document.querySelector('input') as HTMLElement);
    expect(siteSaw).toContain('site:Enter');
  });
});

describe('Ctrl+K', () => {
  const hotkey = (init: KeyboardEventInit = {}, target: EventTarget = input()) => press('k', { code: 'KeyK', ctrlKey: true, ...init }, target);

  it('takes the field back instead of opening a second search over the open one', () => {
    open(['a']);
    (document.querySelector('.close') as HTMLElement).focus();
    input().value = 'naruto';
    const event = hotkey({}, document.querySelector('.close') as HTMLElement);
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:k');
    expect(document.activeElement).toBe(input());
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, 6]);
  });

  it('works on a layout where the key reads as another letter, as the site does', () => {
    open(['a']);
    const event = press('л', { code: 'KeyK', ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:л');
  });

  it('is left to the site when no search is open, so it can open one', () => {
    document.body.innerHTML = '<div></div>';
    const event = hotkey({}, document.body);
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:k');
  });

  it('is left to the site while the open search is closing', () => {
    open(['a']);
    document.querySelector('.vfm')?.classList.add('vfm--prevent-none');
    const event = hotkey();
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:k');
  });

  it('is not claimed without Ctrl, nor for another key', () => {
    open(['a']);
    expect(press('k', { code: 'KeyK', metaKey: true }).defaultPrevented).toBe(false);
    expect(press('k', { code: 'KeyK' }).defaultPrevented).toBe(false);
    expect(press('j', { code: 'KeyJ', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(siteSaw).toEqual(['site:k', 'site:k', 'site:j']);
  });

  it('does nothing once the extension has been unloaded', () => {
    open(['a']);
    isContextAlive = false;
    const event = hotkey();
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:k');
  });
});

describe('plain Enter where the site opens the catalog for the tab', () => {
  const openCatalogPage = ({
    tab = 'Манга',
    headerLink = '/browse/manga',
    slugs = ['a', 'b'],
  }: { tab?: string; headerLink?: string | null; slugs?: string[] } = {}) => {
    const header = headerLink === null ? '' : `<header><a href="${headerLink}">Каталог</a></header>`;
    const tabs = `<div class="tabs"><button class="tabs-tab tabs-tab--active">${tab}</button></div>`;
    document.body.innerHTML = header + modalHtml(slugs, '').replace('<input', `${tabs}<input`);
    watchClicks();
  };

  const typeAndEnter = async (query: string, init: KeyboardEventInit = {}) => {
    typed(query);
    await settle(1000);
    const event = press('Enter', init);
    await settle(1000);
    return event;
  };

  it('leaves Enter to the site, which opens the catalog, when nothing is highlighted', async () => {
    openCatalogPage();
    const event = await typeAndEnter('naruto');
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:Enter');
    expect(clicked).toEqual([]);
  });

  it('does the same for the anime tab where the site has an anime catalog', async () => {
    openCatalogPage({ tab: 'Аниме', headerLink: '/browse/anime' });
    const event = await typeAndEnter('naruto');
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:Enter');
  });

  it('still opens the first result when the site has no catalog of that kind in its header', async () => {
    for (const [tab, headerLink] of [
      ['Аниме', '/browse/manga'],
      ['Манга', '/browse/anime'],
      ['Манга', null],
    ] as const) {
      openCatalogPage({ tab, headerLink });
      clicked.length = 0;
      siteSaw.length = 0;
      const event = await typeAndEnter('naruto');
      expect(event.defaultPrevented).toBe(true);
      expect(siteSaw).not.toContain('site:Enter');
      expect(clicked).toEqual(['/manga/a']);
    }
  });

  it('only counts a catalog link that is in the header', async () => {
    openCatalogPage({ headerLink: null });
    document.body.insertAdjacentHTML('afterbegin', '<footer><a href="/browse/manga">Каталог</a></footer>');
    const event = await typeAndEnter('naruto');
    expect(event.defaultPrevented).toBe(true);
    expect(clicked).toEqual(['/manga/a']);
  });

  it('still opens the first result for the tabs that have no catalog', async () => {
    for (const tab of ['Пользователи', 'Гильдии', 'Персонажи', 'Персонал', 'Команды']) {
      openCatalogPage({ tab });
      clicked.length = 0;
      const event = await typeAndEnter('naruto');
      expect(event.defaultPrevented).toBe(true);
      expect(clicked).toEqual(['/manga/a']);
    }
  });

  it('still opens the first result for a query the catalog search cannot match, such as Cyrillic', async () => {
    for (const query of ['наруто', 'Наруто', 'ナルト', 'naruto наруто']) {
      openCatalogPage();
      clicked.length = 0;
      const event = await typeAndEnter(query);
      expect(event.defaultPrevented).toBe(true);
      expect(clicked).toEqual(['/manga/a']);
    }
  });

  it('keeps a phrase of Latin words and punctuation for the catalog', async () => {
    for (const query of ['one piece', 'Dr. Stone', 'k-on!']) {
      openCatalogPage();
      siteSaw.length = 0;
      const event = await typeAndEnter(query);
      expect(event.defaultPrevented).toBe(false);
      expect(siteSaw).toContain('site:Enter');
    }
  });

  it('opens the highlighted result itself, and the site never sees the key', async () => {
    openCatalogPage();
    typed('naruto');
    await settle(1000);
    press('ArrowDown');
    press('ArrowDown');
    const event = press('Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:Enter');
    expect(clicked).toEqual(['/manga/b']);
  });

  it('keeps Ctrl+Enter for the first result in a new tab', async () => {
    openCatalogPage();
    const event = await typeAndEnter('naruto', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:Enter');
    expect(clicked).toEqual(['/manga/a']);
    expect(clickKeys).toEqual(['ctrl']);
  });

  it('keeps a query that is too short from going anywhere', async () => {
    openCatalogPage();
    const event = await typeAndEnter('n');
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:Enter');
    expect(clicked).toEqual([]);
  });
});
