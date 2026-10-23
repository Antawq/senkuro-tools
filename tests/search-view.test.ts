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
  signals.handleEvent(new CustomEvent(SEARCH_EVENT, { detail: JSON.stringify({ phase, query, type: 'MANGA' }) }));
};

let registry: Map<string, Set<Range>>;
let signals: SearchSignals;
let view: SearchView;
let isContextAlive: boolean;

const installHighlights = () => {
  registry = new Map();
  const pageWindow = document.defaultView as unknown as object;
  Object.defineProperty(pageWindow, 'Highlight', { value: FakeHighlight, configurable: true });
  Object.defineProperty(pageWindow, 'CSS', { value: { highlights: registry }, configurable: true });
};

const matched = () => [...(registry.get('senkutools-match') ?? [])].map((range) => range.toString());

beforeEach(() => {
  vi.useFakeTimers();
  installHighlights();
  isContextAlive = true;
  signals = createSearchSignals();
  view = createSearchView(document, {
    runAfter: (run, delayMs) => void setTimeout(run, delayMs),
    isContextValid: () => isContextAlive,
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
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
    field().value = '';
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(true);
    field().value = 'n';
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(true);
    field().value = 'na';
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
  });

  it('counts only the typed letters, not the spaces around them', () => {
    open(['a'], ' n ');
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(true);
  });

  it('marks nothing while there are no results to hide', () => {
    open([], '');
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
  });

  it('follows the results the page draws afterwards', async () => {
    open([], '');
    view.syncView();
    list().innerHTML = rowsOf('a');
    await settle();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(true);
    list().innerHTML = '';
    await settle();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
  });
});

describe('searching', () => {
  it('turns on once a search has taken a while and off when it ends', async () => {
    open(['a'], 'naruto');
    view.syncView();
    say('start');
    await settle(299);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
    await settle(1);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(true);
    say('done');
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
  });

  it('never shows for a search that answers quickly', async () => {
    open(['a'], 'naruto');
    view.syncView();
    say('start');
    await settle(250);
    say('done');
    await settle(500);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
  });

  it('stays off while the page-world script has not spoken', () => {
    open(['a'], 'naruto');
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
  });

  it('stays off for a query too short to be searched', async () => {
    open(['a'], 'n');
    view.syncView();
    say('start', 'n');
    await settle(400);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
  });

  it('gives up on a search that never reports back', async () => {
    open(['a'], 'naruto');
    view.syncView();
    say('start');
    await settle(400);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(true);
    await settle(4700);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
  });
});

describe('scroll position', () => {
  it('goes back to the top when other results arrive', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.syncView();
    list().scrollTop = 120;
    list().innerHTML = rowsOf('x', 'y', 'z');
    await settle();
    expect(list().scrollTop).toBe(0);
  });

  it('scrolls the list back to the top when other results arrive', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.syncView();
    const scrollTo = vi.spyOn(list(), 'scrollTo');
    list().innerHTML = rowsOf('x', 'y', 'z');
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('is left alone while the same results stay', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.syncView();
    list().scrollTop = 120;
    list().firstElementChild?.classList.add('card-search--active');
    await settle();
    expect(list().scrollTop).toBe(120);
  });
});

describe('which modal it looks at', () => {
  it('ignores a modal that is closing', () => {
    open(['a'], '', 'vfm vfm--prevent-none');
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
  });

  it('does nothing once the extension context is gone', () => {
    open(['a'], '');
    isContextAlive = false;
    view.syncView();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
  });

  it('stops flagging once the extension context is gone while the page keeps changing', async () => {
    open([], '');
    view.syncView();
    isContextAlive = false;
    list().innerHTML = rowsOf('a');
    await settle();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
  });

  it('takes back everything it put on the page when it is disposed', async () => {
    open(['a', 'b'], 'naruto');
    modal().insertAdjacentHTML('afterbegin', '<div class="tabs"><button class="tabs-tab tabs-tab--active">Манга</button></div>');
    document.querySelector('[data-index]')?.classList.add('card-search--active');
    view.syncView();
    say('start');
    await settle(400);
    field().value = '';
    view.syncView();
    const marked = (element: Element) =>
      [...element.attributes]
        .map((attribute) => attribute.name)
        .filter((name) => name !== 'class' && name !== 'href' && name !== 'data-index' && name !== 'value' && name !== 'type');
    expect(marked(modal()).length + marked(field()).length + marked(list()).length).toBeGreaterThan(0);
    view.dispose();
    const everything = [modal(), field(), list(), ...document.querySelectorAll('[data-index], .tabs-tab')];
    expect(everything.flatMap((element) => marked(element))).toEqual([]);
  });

  it('takes the in-flight flag back when it is disposed during a slow search', async () => {
    open(['a'], 'naruto');
    view.syncView();
    say('start');
    await settle(400);
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(true);
    view.dispose();
    expect(modal().hasAttribute('data-senkutools-searching')).toBe(false);
  });

  it('stops watching the page after dispose', async () => {
    open([], '');
    view.syncView();
    view.dispose();
    list().innerHTML = rowsOf('a');
    await settle();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(false);
  });
});

describe('matching words', () => {
  it('marks every occurrence of the typed words in the titles, whatever their case', () => {
    openTitled(['Наруто и НАРУТО', 'Боруто', 'Цикл Naruto'], 'наруто');
    view.syncView();
    expect(matched()).toEqual(['Наруто', 'НАРУТО']);
    field().value = 'naruto';
    view.syncView();
    expect(matched()).toEqual(['Naruto']);
  });

  it('does not care about the case the query was typed in', () => {
    openTitled(['Наруто'], 'НАРУТО');
    view.syncView();
    expect(matched()).toEqual(['Наруто']);
  });

  it('marks side by side matches once, not overlapping ones', () => {
    openTitled(['aaaa'], 'aa');
    view.syncView();
    expect(matched()).toEqual(['aa', 'aa']);
  });

  it('marks each word of a longer query', () => {
    openTitled(['Naruto Uzumaki Boruto'], 'uzumaki naruto');
    view.syncView();
    expect(matched().sort()).toEqual(['Naruto', 'Uzumaki']);
  });

  it('marks the names of other kinds of rows too', () => {
    openTitled(['chumei_'], 'chu', 'card-name');
    view.syncView();
    expect(matched()).toEqual(['chu']);
  });

  it('marks nothing, and leaves no mark behind, when the titles do not contain the query', () => {
    openTitled(['Naruto'], 'naruto');
    view.syncView();
    expect(registry.has('senkutools-match')).toBe(true);
    field().value = 'bleach';
    view.syncView();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('leaves out a one-letter word of a longer query', () => {
    openTitled(['Naruto a Uzumaki'], 'a naruto');
    view.syncView();
    expect(matched()).toEqual(['Naruto']);
  });

  it('marks nothing while the results are those of a query that is no longer there', () => {
    openTitled(['Naruto'], 'naruto');
    view.syncView();
    field().value = 'n';
    view.syncView();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('follows the titles the page draws afterwards, including a changed text', async () => {
    openTitled(['Naruto'], 'naruto');
    view.syncView();
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
    view.syncView();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('removes its marks when it is disposed', () => {
    openTitled(['Naruto'], 'naruto');
    view.syncView();
    expect(registry.has('senkutools-match')).toBe(true);
    view.dispose();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('removes its marks once the modal is gone', () => {
    openTitled(['Naruto'], 'naruto');
    view.syncView();
    document.body.innerHTML = '';
    view.syncView();
    expect(registry.has('senkutools-match')).toBe(false);
  });

  it('works without the highlight API', () => {
    Reflect.deleteProperty(document.defaultView as unknown as object, 'Highlight');
    openTitled(['Naruto'], 'naruto');
    expect(() => view.syncView()).not.toThrow();
    expect(registry.has('senkutools-match')).toBe(false);
  });
});

describe('screen reader wiring', () => {
  const optionIds = () => [...document.querySelectorAll('[data-index]')].map((row) => row.getAttribute('id'));

  it('makes the field a combobox over the result list while results are shown', () => {
    open(['a', 'b'], 'naruto');
    view.syncView();
    expect(field().getAttribute('role')).toBe('combobox');
    expect(field().getAttribute('aria-autocomplete')).toBe('list');
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(field().getAttribute('aria-controls')).toBe(list().id);
    expect(list().getAttribute('role')).toBe('listbox');
  });

  it('names the listbox by the tab it belongs to, so a screen reader says which kind of results these are', async () => {
    open(['a'], 'naruto');
    modal().insertAdjacentHTML(
      'afterbegin',
      '<div class="tabs"><button class="tabs-tab tabs-tab--active">Манга</button><button class="tabs-tab">Аниме</button></div>'
    );
    view.syncView();
    const labelOf = () => document.getElementById(list().getAttribute('aria-labelledby') ?? '')?.textContent;
    expect(labelOf()).toBe('Манга');
    const [first, second] = [...document.querySelectorAll('.tabs-tab')];
    first?.classList.remove('tabs-tab--active');
    second?.classList.add('tabs-tab--active');
    await settle();
    expect(labelOf()).toBe('Аниме');
    expect(new Set([...document.querySelectorAll('.tabs-tab')].map((tab) => tab.id)).size).toBe(2);
  });

  it('leaves the listbox unnamed while it is not one', () => {
    open([], 'naruto');
    modal().insertAdjacentHTML('afterbegin', '<div class="tabs"><button class="tabs-tab tabs-tab--active">Манга</button></div>');
    view.syncView();
    expect(list().hasAttribute('aria-labelledby')).toBe(false);
  });

  it('gives each result the option role and an id of its own', () => {
    open(['a', 'b', 'c'], 'naruto');
    view.syncView();
    expect([...document.querySelectorAll('[data-index]')].map((row) => row.getAttribute('role'))).toEqual(['option', 'option', 'option']);
    expect(new Set(optionIds()).size).toBe(3);
    expect(optionIds().every((id) => id && document.querySelectorAll(`[id="${id}"]`).length === 1)).toBe(true);
  });

  it('follows the highlighted result the keys set', async () => {
    open(['a', 'b', 'c'], 'naruto');
    view.syncView();
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
    view.syncView();
    expect(field().getAttribute('role')).toBe('combobox');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().hasAttribute('aria-controls')).toBe(false);
    expect(list().hasAttribute('role')).toBe(false);
    expect(list().hasAttribute('id')).toBe(false);
  });

  it('takes the list back as soon as the results are stale', () => {
    open(['a', 'b'], 'naruto');
    document.querySelector('[data-index]')?.classList.add('card-search--active');
    view.syncView();
    expect(field().hasAttribute('aria-activedescendant')).toBe(true);
    field().value = '';
    view.syncView();
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(list().hasAttribute('role')).toBe(false);
    expect(document.querySelector('[data-index]')?.hasAttribute('role')).toBe(false);
    expect(document.querySelector('[data-index]')?.hasAttribute('aria-selected')).toBe(false);
    expect(field().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('wires the results the page draws afterwards', async () => {
    open([], 'naruto');
    view.syncView();
    list().innerHTML = rowsOf('a', 'b');
    await settle();
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(optionIds()).toHaveLength(2);
  });

  it('writes nothing when nothing has changed', async () => {
    open(['a', 'b'], 'naruto');
    view.syncView();
    const writes: string[] = [];
    new MutationObserver((records) => records.forEach((record) => writes.push(record.attributeName ?? ''))).observe(modal(), {
      attributes: true,
      subtree: true,
    });
    view.syncView();
    view.syncView();
    await settle();
    expect(writes).toEqual([]);
  });
});

describe('clicks', () => {
  const withControls = (slugs: string[], query = 'naruto') => {
    open(slugs, query);
    modal().insertAdjacentHTML(
      'afterbegin',
      '<div class="tabs"><button class="tabs-tab">Манга</button></div><span class="input-suffix"><svg class="icon-click"></svg></span>'
    );
    list().insertAdjacentHTML('beforeend', '<div class="nav-search__cnt-space"><button class="chip">naruto</button></div>');
  };

  const pointer = (target: Element, init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init });
    target.dispatchEvent(event);
    return event;
  };

  const emulateHover = (matches: boolean) => {
    Object.defineProperty(document.defaultView as unknown as object, 'matchMedia', {
      value: (query: string) => ({ matches: matches && query === '(hover: hover)' }),
      configurable: true,
    });
  };

  let siteClicks: string[];

  const siteHandler = (event: Event) => siteClicks.push((event.target as Element).className || (event.target as Element).tagName);

  beforeEach(() => {
    emulateHover(true);
    siteClicks = [];
    document.addEventListener('click', siteHandler);
    document.addEventListener('click', view.handleClick, { capture: true });
  });

  afterEach(() => {
    document.removeEventListener('click', siteHandler);
    document.removeEventListener('click', view.handleClick, { capture: true });
    Reflect.deleteProperty(document.defaultView as unknown as object, 'matchMedia');
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['shiftKey', { shiftKey: true }],
  ])('keeps the site from closing the search on a result clicked with %s, and leaves the browser its new tab', (_name, init) => {
    withControls(['a', 'b']);
    const event = pointer(document.querySelector('[data-index]') as Element, init);
    expect(siteClicks).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves a plain click on a result to the site', () => {
    withControls(['a']);
    pointer(document.querySelector('[data-index]') as Element);
    expect(siteClicks).toHaveLength(1);
  });

  it('leaves a modified click anywhere else to the site', () => {
    withControls(['a']);
    pointer(document.querySelector('.tabs-tab') as Element, { ctrlKey: true });
    expect(siteClicks).toHaveLength(1);
  });

  it('leaves a modified click on a result alone when the search is closing or not open', () => {
    withControls(['a']);
    document.querySelector('.vfm')?.classList.add('vfm--prevent-none');
    pointer(document.querySelector('[data-index]') as Element, { ctrlKey: true });
    expect(siteClicks).toHaveLength(1);
  });

  it.each([
    ['a tab', '.tabs-tab'],
    ['the clear and microphone icons', '.icon-click'],
    ['a popular query', '.nav-search__cnt-space button'],
  ])('gives the field back after a mouse click on %s', async (_name, selector) => {
    withControls(['a']);
    (document.querySelector(selector) as HTMLElement).focus?.();
    pointer(document.querySelector(selector) as Element);
    await settle();
    expect(document.activeElement).toBe(field());
  });

  it('leaves the focus alone after a click on a result or on empty space of the modal', async () => {
    withControls(['a']);
    const button = document.querySelector('.tabs-tab') as HTMLElement;
    button.focus();
    pointer(document.querySelector('[data-index]') as Element);
    pointer(list());
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it('leaves the focus alone after a click made with the keyboard, which reports no click count', async () => {
    withControls(['a']);
    const button = document.querySelector('.tabs-tab') as HTMLElement;
    button.focus();
    pointer(button, { detail: 0 });
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it('leaves the focus alone on a device without a mouse, so the keyboard does not pop up again', async () => {
    emulateHover(false);
    withControls(['a']);
    const button = document.querySelector('.tabs-tab') as HTMLElement;
    button.focus();
    pointer(button);
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it('does not give the field back once the extension is gone', async () => {
    withControls(['a']);
    const button = document.querySelector('.tabs-tab') as HTMLElement;
    button.focus();
    pointer(button);
    isContextAlive = false;
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it('shows the stale state after a click that empties the field without any input event', async () => {
    withControls(['a']);
    view.syncView();
    document.querySelector('.icon-click')?.addEventListener('click', () => (field().value = ''));
    pointer(document.querySelector('.icon-click') as Element);
    await settle();
    expect(modal().hasAttribute('data-senkutools-stale')).toBe(true);
  });

  it('leaves a modified click on a list elsewhere on the page alone, with the search open', () => {
    withControls(['a']);
    document.body.insertAdjacentHTML('beforeend', '<a class="elsewhere" data-index="0" href="/x">x</a>');
    pointer(document.querySelector('.elsewhere') as Element, { ctrlKey: true });
    expect(siteClicks).toHaveLength(1);
  });

  it('ignores clicks outside the modal and once the extension is gone', () => {
    withControls(['a']);
    document.body.insertAdjacentHTML('beforeend', '<button class="outside">x</button>');
    pointer(document.querySelector('.outside') as Element, { ctrlKey: true });
    expect(siteClicks).toHaveLength(1);
    isContextAlive = false;
    pointer(document.querySelector('[data-index]') as Element, { ctrlKey: true });
    expect(siteClicks).toHaveLength(2);
  });
});
