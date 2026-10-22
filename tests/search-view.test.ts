import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSearchSignals, SEARCH_EVENT, type SearchSignals } from '../utils/search/search-signal';
import { createSearchView, type SearchView } from '../utils/search/search-view';

const rowsOf = (...slugs: string[]) => slugs.map((slug, index) => `<a class="card-search" data-index="${index}" href="/manga/${slug}">${slug}</a>`).join('');

const open = (slugs: string[], query: string, hostClass = 'vfm') => {
  document.body.innerHTML = `
    <div class="${hostClass}">
      <div class="vfm__content modal-content modal-content--search">
        <input class="input-el" value="${query}">
        <div class="nav-search__cnt">${rowsOf(...slugs)}</div>
      </div>
    </div>`;
};

const modal = () => document.querySelector('.modal-content--search') as HTMLElement;
const field = () => document.querySelector('input.input-el') as HTMLInputElement;
const list = () => document.querySelector('.nav-search__cnt') as HTMLElement;

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

const say = (phase: 'start' | 'done', query = 'naruto') => {
  signals.event(new CustomEvent(SEARCH_EVENT, { detail: JSON.stringify({ phase, query, type: 'MANGA' }) }));
};

let signals: SearchSignals;
let view: SearchView;
let alive: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  alive = true;
  signals = createSearchSignals();
  view = createSearchView(document, {
    later: (run, ms) => void setTimeout(run, ms),
    alive: () => alive,
    signals,
  });
});

afterEach(() => {
  view.dispose();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('stale results', () => {
  it('marks the results of an earlier query once the field is cleared', () => {
    open(['a', 'b'], 'naruto');
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(false);
    field().value = '';
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(true);
    field().value = 'n';
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(true);
    field().value = 'na';
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(false);
  });

  it('counts only the typed letters, not the spaces around them', () => {
    open(['a'], ' n ');
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(true);
  });

  it('marks nothing while there are no results to hide', () => {
    open([], '');
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(false);
  });

  it('follows the results the page draws afterwards', async () => {
    open([], '');
    view.touch();
    list().innerHTML = rowsOf('a');
    await settle();
    expect(modal().hasAttribute('data-stale')).toBe(true);
    list().innerHTML = '';
    await settle();
    expect(modal().hasAttribute('data-stale')).toBe(false);
  });
});

describe('searching', () => {
  it('is on from the page-world start of a search to its end', () => {
    open(['a'], 'naruto');
    view.touch();
    expect(modal().hasAttribute('data-searching')).toBe(false);
    say('start');
    expect(modal().hasAttribute('data-searching')).toBe(true);
    say('done');
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('stays off while the page-world script has not spoken', () => {
    open(['a'], 'naruto');
    view.touch();
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('stays off for a query too short to be searched', () => {
    open(['a'], 'n');
    view.touch();
    say('start', 'n');
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('gives up on a search that never reports back', async () => {
    open(['a'], 'naruto');
    view.touch();
    say('start');
    expect(modal().hasAttribute('data-searching')).toBe(true);
    await settle(5100);
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });
});

describe('scroll position', () => {
  it('goes back to the top when other results arrive', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.touch();
    list().scrollTop = 120;
    list().innerHTML = rowsOf('x', 'y', 'z');
    await settle();
    expect(list().scrollTop).toBe(0);
  });

  it('is left alone while the same results stay', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.touch();
    list().scrollTop = 120;
    list().firstElementChild?.classList.add('card-search--active');
    await settle();
    expect(list().scrollTop).toBe(120);
  });
});

describe('which modal it looks at', () => {
  it('ignores a modal that is closing', () => {
    open(['a'], '', 'vfm vfm--prevent-none');
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(false);
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('does nothing once the extension context is gone', () => {
    open(['a'], '');
    alive = false;
    view.touch();
    expect(modal().hasAttribute('data-stale')).toBe(false);
  });

  it('stops flagging once the extension context is gone while the page keeps changing', async () => {
    open([], '');
    view.touch();
    alive = false;
    list().innerHTML = rowsOf('a');
    await settle();
    expect(modal().hasAttribute('data-stale')).toBe(false);
  });

  it('stops watching the page after dispose', async () => {
    open([], '');
    view.touch();
    view.dispose();
    list().innerHTML = rowsOf('a');
    await settle();
    expect(modal().hasAttribute('data-stale')).toBe(false);
  });
});
