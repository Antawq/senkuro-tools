import { ACTIVE, LIST, ROW, TAB, TAB_ACTIVE, TITLE, fieldOf, isTooShort, rowsOf, topModal } from './search-dom';
import { MAX_PENDING_MS, type SearchSignals } from './search-signal';

const STALE = 'data-stale';
const SEARCHING = 'data-searching';
const MATCH = 'senkutools-match';
const LIST_ID = 'senkutools-search-list';
const OPTION_ID = 'senkutools-search-option-';
const TAB_ID = 'senkutools-search-tab-';
const MIN_WORD_LENGTH = 2;
const SLOW_SEARCH_MS = 300;
const REFOCUS = '.tabs-tab, .icon-click, .nav-search__cnt-space button';
const HOVER = '(hover: hover)';

export interface SearchViewHost {
  later: (run: () => void, ms: number) => void;
  alive: () => boolean;
  signals: SearchSignals;
}

export interface SearchView {
  touch: () => void;
  click: (event: MouseEvent) => void;
  dispose: () => void;
}

const flag = (element: HTMLElement, name: string, on: boolean): void => {
  if (element.hasAttribute(name) !== on) element.toggleAttribute(name, on);
};

const signatureOf = (rows: HTMLElement[]): string => rows.map((row) => row.getAttribute('href') ?? '').join('|');

const attribute = (element: HTMLElement, name: string, value: string | null): void => {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

const wordsOf = (query: string): string[] => [
  ...new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= MIN_WORD_LENGTH)
  ),
];

export function createSearchView(doc: Document, { later, alive, signals }: SearchViewHost): SearchView {
  let session: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let shownSignature = '';

  const matchesIn = (titles: HTMLElement[], words: string[]): Range[] => {
    const ranges: Range[] = [];
    for (const title of titles) {
      const texts = doc.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let node = texts.nextNode(); node; node = texts.nextNode()) {
        const text = node.nodeValue ?? '';
        const lower = text.toLowerCase();
        if (lower.length !== text.length) continue;
        for (const word of words) {
          for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) {
            const range = doc.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + word.length);
            ranges.push(range);
          }
        }
      }
    }
    return ranges;
  };

  const paint = (modal: HTMLElement, query: string): void => {
    const view = doc.defaultView;
    if (!view?.CSS?.highlights || typeof view.Highlight !== 'function') return;
    const ranges = matchesIn([...modal.querySelectorAll<HTMLElement>(TITLE)], wordsOf(query));
    if (ranges.length > 0) view.CSS.highlights.set(MATCH, new view.Highlight(...ranges));
    else view.CSS.highlights.delete(MATCH);
  };

  const announce = (modal: HTMLElement, rows: HTMLElement[], shown: boolean, managed = true): void => {
    const active = rows.find((row) => row.classList.contains(ACTIVE));
    const field = fieldOf(modal);
    if (field) {
      attribute(field, 'role', managed ? 'combobox' : null);
      attribute(field, 'aria-autocomplete', managed ? 'list' : null);
      attribute(field, 'aria-expanded', managed ? String(shown) : null);
      attribute(field, 'aria-controls', shown ? LIST_ID : null);
      attribute(field, 'aria-activedescendant', shown && active ? active.id : null);
    }
    modal.querySelectorAll<HTMLElement>(TAB).forEach((tab, index) => attribute(tab, 'id', managed ? `${TAB_ID}${index}` : null));
    const list = modal.querySelector<HTMLElement>(LIST);
    if (list) {
      attribute(list, 'role', shown ? 'listbox' : null);
      attribute(list, 'id', shown ? LIST_ID : null);
      attribute(list, 'aria-labelledby', shown ? (modal.querySelector<HTMLElement>(TAB_ACTIVE)?.id ?? null) : null);
    }
    rows.forEach((row, index) => {
      attribute(row, 'role', shown ? 'option' : null);
      attribute(row, 'id', shown ? `${OPTION_ID}${index}` : null);
      attribute(row, 'aria-selected', shown ? String(row === active) : null);
    });
  };

  const unpaint = (): void => {
    doc.defaultView?.CSS?.highlights?.delete(MATCH);
  };

  const render = (): void => {
    const modal = session;
    if (!modal || !alive()) return;
    const query = fieldOf(modal)?.value ?? '';
    const rows = rowsOf(modal);
    const tooShort = isTooShort(query);
    const stale = tooShort && rows.length > 0;
    flag(modal, STALE, stale);
    announce(modal, rows, rows.length > 0 && !stale);
    flag(modal, SEARCHING, !tooShort && signals.waited() >= SLOW_SEARCH_MS);
    paint(modal, query);
    const signature = signatureOf(rows);
    if (signature === shownSignature) return;
    shownSignature = signature;
    modal.querySelector<HTMLElement>(LIST)?.scrollTo({ top: 0, behavior: 'instant' });
  };

  const dispose = (): void => {
    if (session) {
      flag(session, STALE, false);
      flag(session, SEARCHING, false);
      announce(session, rowsOf(session), false, false);
    }
    unpaint();
    observer?.disconnect();
    observer = null;
    session = null;
  };

  const adopt = (): void => {
    const found = topModal(doc);
    if (found === session) return;
    observer?.disconnect();
    observer = null;
    session = found;
    shownSignature = '';
    unpaint();
    if (!found) return;
    observer = new MutationObserver(render);
    observer.observe(found, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  };

  signals.subscribe(() => {
    render();
    if (!session || !signals.pending()) return;
    later(render, SLOW_SEARCH_MS);
    later(render, MAX_PENDING_MS + 50);
  });

  const touch = (): void => {
    if (!alive()) {
      dispose();
      return;
    }
    adopt();
    render();
  };

  const click = (event: MouseEvent): void => {
    const modal = alive() ? topModal(doc) : null;
    const target = event.target;
    if (!modal || !(target instanceof Element) || !modal.contains(target)) return;
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && target.closest(ROW)) {
      event.stopImmediatePropagation();
      return;
    }
    const pointed = event.detail > 0 && target.closest(REFOCUS) !== null && doc.defaultView?.matchMedia(HOVER).matches === true;
    later(() => {
      touch();
      if (pointed && alive()) fieldOf(modal)?.focus({ preventScroll: true });
    }, 0);
  };

  return { touch, click, dispose };
}
