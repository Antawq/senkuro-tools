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

class FakeHighlight extends Set<Range> {
  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

const titledRows = (...titles: string[]) =>
  titles.map((title, index) => `<a class="card-search" data-index="${index}" href="/manga/t${index}"><h3 class="card-title">${title}</h3></a>`).join('');

const openTitled = (titles: string[], query: string, name = 'card-title') => {
  open([], query);
  list().innerHTML = titledRows(...titles).replaceAll('card-title', name);
};

const modal = () => document.querySelector('.modal-content--search') as HTMLElement;
const field = () => document.querySelector('input.input-el') as HTMLInputElement;
const list = () => document.querySelector('.nav-search__cnt') as HTMLElement;

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

const say = (phase: 'start' | 'done', query = 'naruto') => {
  signals.event(new CustomEvent(SEARCH_EVENT, { detail: JSON.stringify({ phase, query, type: 'MANGA' }) }));
};

let registry: Map<string, Set<Range>>;
let signals: SearchSignals;
let view: SearchView;
let alive: boolean;

const installHighlights = () => {
  registry = new Map();
  const win = document.defaultView as unknown as object;
  Object.defineProperty(win, 'Highlight', { value: FakeHighlight, configurable: true });
  Object.defineProperty(win, 'CSS', { value: { highlights: registry }, configurable: true });
};

const matched = () => [...(registry.get('senkutools-match') ?? [])].map((range) => range.toString());

beforeEach(() => {
  vi.useFakeTimers();
  installHighlights();
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
  Reflect.deleteProperty(document.defaultView as unknown as object, 'Highlight');
  Reflect.deleteProperty(document.defaultView as unknown as object, 'CSS');
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
  it('turns on once a search has taken a while and off when it ends', async () => {
    open(['a'], 'naruto');
    view.touch();
    say('start');
    await settle(299);
    expect(modal().hasAttribute('data-searching')).toBe(false);
    await settle(1);
    expect(modal().hasAttribute('data-searching')).toBe(true);
    say('done');
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('never shows for a search that answers quickly', async () => {
    open(['a'], 'naruto');
    view.touch();
    say('start');
    await settle(250);
    say('done');
    await settle(500);
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('stays off while the page-world script has not spoken', () => {
    open(['a'], 'naruto');
    view.touch();
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('stays off for a query too short to be searched', async () => {
    open(['a'], 'n');
    view.touch();
    say('start', 'n');
    await settle(400);
    expect(modal().hasAttribute('data-searching')).toBe(false);
  });

  it('gives up on a search that never reports back', async () => {
    open(['a'], 'naruto');
    view.touch();
    say('start');
    await settle(400);
    expect(modal().hasAttribute('data-searching')).toBe(true);
    await settle(4700);
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

  it('jumps instead of gliding, so the old position is never seen scrolling away', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.touch();
    const scrollTo = vi.spyOn(list(), 'scrollTo');
    list().innerHTML = rowsOf('x', 'y', 'z');
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
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

describe('matching words', () => {
  it('marks every occurrence of the typed words in the titles, whatever their case', () => {
    openTitled(['Наруто и НАРУТО', 'Боруто', 'Цикл Naruto'], 'наруто');
    view.touch();
    expect(matched()).toEqual(['Наруто', 'НАРУТО']);
    field().value = 'naruto';
    view.touch();
    expect(matched()).toEqual(['Naruto']);
  });

  it('does not care about the case the query was typed in', () => {
    openTitled(['Наруто'], 'НАРУТО');
    view.touch();
    expect(matched()).toEqual(['Наруто']);
  });

  it('marks side by side matches once, not overlapping ones', () => {
    openTitled(['aaaa'], 'aa');
    view.touch();
    expect(matched()).toEqual(['aa', 'aa']);
  });

  it('marks each word of a longer query', () => {
    openTitled(['Naruto Uzumaki Boruto'], 'uzumaki naruto');
    view.touch();
    expect(matched().sort()).toEqual(['Naruto', 'Uzumaki']);
  });

  it('marks the names of other kinds of rows too', () => {
    openTitled(['chumei_'], 'chu', 'card-name');
    view.touch();
    expect(matched()).toEqual(['chu']);
  });

  it('marks nothing, and leaves no mark behind, when the titles do not contain the query', () => {
    openTitled(['Naruto'], 'naruto');
    view.touch();
    expect(registry.has('senkutools-match')).toBe(true);
    field().value = 'bleach';
    view.touch();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('leaves out a one-letter word of a longer query', () => {
    openTitled(['Naruto a Uzumaki'], 'a naruto');
    view.touch();
    expect(matched()).toEqual(['Naruto']);
  });

  it('marks nothing while the results are those of a query that is no longer there', () => {
    openTitled(['Naruto'], 'naruto');
    view.touch();
    field().value = 'n';
    view.touch();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('follows the titles the page draws afterwards, including a changed text', async () => {
    openTitled(['Naruto'], 'naruto');
    view.touch();
    list().innerHTML = titledRows('Boruto', 'Naruto Shippuden');
    await settle();
    expect(matched()).toEqual(['Naruto']);
    const title = list().querySelector('h3.card-title');
    if (title?.firstChild) title.firstChild.nodeValue = 'Naruto naruto';
    await settle();
    expect(matched()).toEqual(['Naruto', 'naruto', 'Naruto']);
  });

  it('skips a text whose lower case is longer than itself rather than mark the wrong letters', () => {
    openTitled(['İ naruto'], 'naruto');
    view.touch();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('removes its marks when it is disposed', () => {
    openTitled(['Naruto'], 'naruto');
    view.touch();
    expect(registry.has('senkutools-match')).toBe(true);
    view.dispose();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('removes its marks once the modal is gone', () => {
    openTitled(['Naruto'], 'naruto');
    view.touch();
    document.body.innerHTML = '';
    view.touch();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('works without the highlight API', () => {
    Reflect.deleteProperty(document.defaultView as unknown as object, 'Highlight');
    openTitled(['Naruto'], 'naruto');
    expect(() => view.touch()).not.toThrow();
    expect(registry.has('senkutools-match')).toBe(false);
  });
});

describe('screen reader wiring', () => {
  const optionIds = () => [...document.querySelectorAll('[data-index]')].map((row) => row.getAttribute('id'));

  it('makes the field a combobox over the result list while results are shown', () => {
    open(['a', 'b'], 'naruto');
    view.touch();
    expect(field().getAttribute('role')).toBe('combobox');
    expect(field().getAttribute('aria-autocomplete')).toBe('list');
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(field().getAttribute('aria-controls')).toBe(list().id);
    expect(list().getAttribute('role')).toBe('listbox');
  });

  it('gives each result the option role and an id of its own', () => {
    open(['a', 'b', 'c'], 'naruto');
    view.touch();
    expect([...document.querySelectorAll('[data-index]')].map((row) => row.getAttribute('role'))).toEqual(['option', 'option', 'option']);
    expect(new Set(optionIds()).size).toBe(3);
    expect(optionIds().every((id) => id && document.querySelectorAll(`[id="${id}"]`).length === 1)).toBe(true);
  });

  it('follows the highlighted result the keys set', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.touch();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-index]')];
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false']);
    expect(field().hasAttribute('aria-activedescendant')).toBe(false);
    rows[1]?.classList.add('card-search--active');
    await settle();
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(field().getAttribute('aria-activedescendant')).toBe(rows[1]?.id);
    rows[1]?.classList.remove('card-search--active');
    await settle();
    expect(field().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('describes a field with nothing to choose from as collapsed and the list as no listbox', () => {
    open([], 'naruto');
    view.touch();
    expect(field().getAttribute('role')).toBe('combobox');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().hasAttribute('aria-controls')).toBe(false);
    expect(list().hasAttribute('role')).toBe(false);
    expect(list().hasAttribute('id')).toBe(false);
  });

  it('takes the list back as soon as the results are stale', () => {
    open(['a', 'b'], 'naruto');
    document.querySelector('[data-index]')?.classList.add('card-search--active');
    view.touch();
    expect(field().hasAttribute('aria-activedescendant')).toBe(true);
    field().value = '';
    view.touch();
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(list().hasAttribute('role')).toBe(false);
    expect(document.querySelector('[data-index]')?.hasAttribute('role')).toBe(false);
    expect(document.querySelector('[data-index]')?.hasAttribute('aria-selected')).toBe(false);
    expect(field().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('wires the results the page draws afterwards', async () => {
    open([], 'naruto');
    view.touch();
    list().innerHTML = rowsOf('a', 'b');
    await settle();
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(optionIds()).toHaveLength(2);
  });

  it('writes nothing when nothing has changed', async () => {
    open(['a', 'b'], 'naruto');
    view.touch();
    const writes: string[] = [];
    new MutationObserver((records) => records.forEach((record) => writes.push(record.attributeName ?? ''))).observe(modal(), {
      attributes: true,
      subtree: true,
    });
    view.touch();
    view.touch();
    await settle();
    expect(writes).toEqual([]);
  });
});
