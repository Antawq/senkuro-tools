import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSearchKeys, type SearchKeys } from '../utils/search/search-keys';

const ACTIVE = 'card-search--active';

const row = (index: number, slug: string) => `<a class="card-search" data-index="${index}" href="/manga/${slug}">${slug}</a>`;

const rowsOf = (...slugs: string[]) => slugs.map((slug, index) => row(index, slug)).join('');

const open = (slugs: string[], query = 'naruto') => {
  document.body.innerHTML = `
    <div class="modal-content modal-content--search">
      <input class="input-el" value="${query}">
      <button class="close">x</button>
      <div class="nav-search__cnt">${rowsOf(...slugs)}</div>
    </div>`;
};

const input = () => document.querySelector<HTMLInputElement>('input.input-el') as HTMLInputElement;
const list = () => document.querySelector('.nav-search__cnt') as HTMLElement;
const rows = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-index]')];
const activeIndexes = () => rows().flatMap((el, index) => (el.classList.contains(ACTIVE) ? [index] : []));

const clicked: string[] = [];
let siteSaw: string[];
let keys: SearchKeys;
let detach: (() => void)[];

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = input()) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const typed = (value: string) => {
  input().value = value;
  input().dispatchEvent(new Event('input', { bubbles: true }));
};

const arrive = (...slugs: string[]) => {
  list().innerHTML = rowsOf(...slugs);
  watchClicks();
};

function watchClicks() {
  for (const el of rows()) {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      clicked.push(el.getAttribute('href') ?? '');
    });
  }
}

const listen = (type: string, handler: (event: never) => void, options?: AddEventListenerOptions) => {
  document.addEventListener(type, handler as EventListener, options);
  detach.push(() => document.removeEventListener(type, handler as EventListener, options));
};

beforeEach(() => {
  vi.useFakeTimers();
  clicked.length = 0;
  siteSaw = [];
  detach = [];
  keys = createSearchKeys(document, (run, ms) => void setTimeout(run, ms));
  listen('keydown', keys.keydown, { capture: true });
  listen('input', keys.input, { capture: true });
  listen('keydown', (event: KeyboardEvent) => siteSaw.push(`site:${event.key}`));
});

afterEach(() => {
  detach.forEach((remove) => remove());
  vi.useRealTimers();
});

describe('Enter', () => {
  it('opens the first result when nothing is highlighted, and the site never sees the key', () => {
    open(['a', 'b', 'c']);
    watchClicks();
    const event = press('Enter');
    expect(clicked).toEqual(['/manga/a']);
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:Enter');
  });

  it('opens the highlighted result', () => {
    open(['a', 'b', 'c']);
    watchClicks();
    press('ArrowDown');
    press('ArrowDown');
    press('Enter');
    expect(clicked).toEqual(['/manga/b']);
  });

  it('opens a result of any type, not only manga', () => {
    document.body.innerHTML = `
      <div class="modal-content modal-content--search">
        <input class="input-el" value="chu">
        <div class="nav-search__cnt"><a class="card-search" data-index="0" href="/users/@1">chu</a></div>
      </div>`;
    watchClicks();
    press('Enter');
    expect(clicked).toEqual(['/users/@1']);
  });

  it('waits for fresh results when it is pressed right after typing', () => {
    open(['old-a', 'old-b']);
    watchClicks();
    typed('naruto');
    press('Enter');
    expect(clicked).toEqual([]);
    vi.advanceTimersByTime(300);
    arrive('new-a', 'new-b');
    vi.advanceTimersByTime(100);
    expect(clicked).toEqual(['/manga/new-a']);
  });

  it('opens the shown results once they have had time to settle, even if they did not change', () => {
    open(['a', 'b']);
    watchClicks();
    typed('naruto');
    press('Enter');
    vi.advanceTimersByTime(2000);
    expect(clicked).toEqual(['/manga/a']);
  });

  it('waits for results when none are shown yet, and gives up quietly when none come', () => {
    open([]);
    typed('naruto');
    press('Enter');
    vi.advanceTimersByTime(5000);
    expect(clicked).toEqual([]);
    arrive('late');
    vi.advanceTimersByTime(1000);
    expect(clicked).toEqual([]);
  });

  it('opens results that arrive within the wait', () => {
    open([]);
    typed('naruto');
    press('Enter');
    vi.advanceTimersByTime(500);
    arrive('late');
    vi.advanceTimersByTime(500);
    expect(clicked).toEqual(['/manga/late']);
  });

  it('runs once when it is pressed again during the wait', () => {
    open([]);
    typed('naruto');
    press('Enter');
    press('Enter');
    arrive('late');
    vi.advanceTimersByTime(1500);
    expect(clicked).toEqual(['/manga/late']);
  });

  it('is left to the site with no results and a query too short to search', () => {
    open([], 'n');
    const event = press('Enter');
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:Enter');
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['altKey', { altKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['composing', { isComposing: true }],
  ])('is left alone with %s', (_name, init) => {
    open(['a']);
    watchClicks();
    const event = press('Enter', init);
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('is left alone when the search is not open', () => {
    document.body.innerHTML = '<input class="input-el" value="naruto">';
    const event = press('Enter');
    expect(event.defaultPrevented).toBe(false);
    expect(siteSaw).toContain('site:Enter');
  });

  it('does not take the key from a button that has the focus', () => {
    open(['a']);
    watchClicks();
    const close = document.querySelector('.close') as HTMLElement;
    const event = press('Enter', {}, close);
    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
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

  it('takes the arrow from the site and from the caret', () => {
    open(['a', 'b']);
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(siteSaw).not.toContain('site:ArrowDown');
  });

  it('forgets the highlight when the results change, so the next arrow starts at the top', () => {
    open(['a', 'b', 'c', 'd', 'e', 'f']);
    for (let i = 0; i < 6; i += 1) press('ArrowDown');
    expect(activeIndexes()).toEqual([5]);
    typed('bleach');
    arrive('x', 'y', 'z', 'w');
    press('ArrowDown');
    expect(activeIndexes()).toEqual([0]);
  });

  it('forgets the highlight when the results change without typing, as on a tab switch', () => {
    open(['a', 'b', 'c', 'd', 'e', 'f']);
    for (let i = 0; i < 6; i += 1) press('ArrowDown');
    arrive('x', 'y');
    press('ArrowDown');
    expect(activeIndexes()).toEqual([0]);
  });

  it('opens the first new result after the results changed under a highlight', () => {
    open(['a', 'b', 'c', 'd', 'e', 'f']);
    for (let i = 0; i < 6; i += 1) press('ArrowDown');
    typed('bleach');
    arrive('x', 'y');
    press('Enter');
    vi.advanceTimersByTime(1000);
    expect(clicked).toEqual(['/manga/x']);
  });

  it('is left to the site with no results', () => {
    open([]);
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(false);
  });

  it('is left alone on a focused button, so tabs keep moving with the arrows', () => {
    open(['a']);
    const close = document.querySelector('.close') as HTMLElement;
    const event = press('ArrowDown', {}, close);
    expect(event.defaultPrevented).toBe(false);
    expect(activeIndexes()).toEqual([]);
  });
});
