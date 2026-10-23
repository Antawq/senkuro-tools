import {
  ACTIVE_ROW_CLASS,
  ACTIVE_TAB,
  RESULTS,
  RESULT_ROW,
  RESULT_TITLE,
  TAB,
  fieldOf,
  findTopSearchModal,
  isTooShort,
  rowsOf,
  signatureOf,
  type SearchHost,
} from './search-dom';
import { MAX_PENDING_MS } from './search-signal';

const STALE = 'data-stale';
const SEARCHING = 'data-searching';
const MATCH_HIGHLIGHT = 'senkutools-match';
const RESULTS_ID = 'senkutools-search-results';
const OPTION_ID = 'senkutools-search-option-';
const TAB_ID = 'senkutools-search-tab-';
const MIN_WORD_CHARACTERS = 2;
const SLOW_SEARCH_MS = 300;
const EXPIRY_MARGIN_MS = 50;
const REFOCUS_TRIGGER = '.tabs-tab, .icon-click, .nav-search__cnt-space button';
const HOVER_MEDIA_QUERY = '(hover: hover)';

export interface SearchView {
  syncView: () => void;
  handleClick: (event: MouseEvent) => void;
  dispose: () => void;
}

const flag = (element: HTMLElement, name: string, on: boolean): void => {
  if (element.hasAttribute(name) !== on) element.toggleAttribute(name, on);
};

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
      .filter((word) => word.length >= MIN_WORD_CHARACTERS)
  ),
];

export function createSearchView(doc: Document, { runAfter, isContextValid, signals }: SearchHost): SearchView {
  let searchModal: HTMLElement | null = null;
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

  const paint = (searchModal: HTMLElement, query: string): void => {
    const view = doc.defaultView;
    if (!view?.CSS?.highlights || typeof view.Highlight !== 'function') return;
    const ranges = matchesIn([...searchModal.querySelectorAll<HTMLElement>(RESULT_TITLE)], wordsOf(query));
    if (ranges.length > 0) view.CSS.highlights.set(MATCH_HIGHLIGHT, new view.Highlight(...ranges));
    else view.CSS.highlights.delete(MATCH_HIGHLIGHT);
  };

  const announce = (searchModal: HTMLElement, rows: HTMLElement[], shown: boolean, managed = true): void => {
    const active = rows.find((row) => row.classList.contains(ACTIVE_ROW_CLASS));
    const field = fieldOf(searchModal);
    if (field) {
      attribute(field, 'role', managed ? 'combobox' : null);
      attribute(field, 'aria-autocomplete', managed ? 'list' : null);
      attribute(field, 'aria-expanded', managed ? String(shown) : null);
      attribute(field, 'aria-controls', shown ? RESULTS_ID : null);
      attribute(field, 'aria-activedescendant', shown && active ? active.id : null);
    }
    searchModal.querySelectorAll<HTMLElement>(TAB).forEach((tab, index) => attribute(tab, 'id', managed ? `${TAB_ID}${index}` : null));
    const list = searchModal.querySelector<HTMLElement>(RESULTS);
    if (list) {
      attribute(list, 'role', shown ? 'listbox' : null);
      attribute(list, 'id', shown ? RESULTS_ID : null);
      attribute(list, 'aria-labelledby', shown ? (searchModal.querySelector<HTMLElement>(ACTIVE_TAB)?.id ?? null) : null);
    }
    rows.forEach((row, index) => {
      attribute(row, 'role', shown ? 'option' : null);
      attribute(row, 'id', shown ? `${OPTION_ID}${index}` : null);
      attribute(row, 'aria-selected', shown ? String(row === active) : null);
    });
  };

  const unpaint = (): void => {
    doc.defaultView?.CSS?.highlights?.delete(MATCH_HIGHLIGHT);
  };

  const render = (): void => {
    const openSearchModal = searchModal;
    if (!openSearchModal || !isContextValid()) return;
    const query = fieldOf(openSearchModal)?.value ?? '';
    const rows = rowsOf(openSearchModal);
    const tooShort = isTooShort(query);
    const stale = tooShort && rows.length > 0;
    flag(openSearchModal, STALE, stale);
    announce(openSearchModal, rows, rows.length > 0 && !stale);
    flag(openSearchModal, SEARCHING, !tooShort && signals.waited() >= SLOW_SEARCH_MS);
    paint(openSearchModal, query);
    const signature = signatureOf(rows);
    if (signature === shownSignature) return;
    shownSignature = signature;
    openSearchModal.querySelector<HTMLElement>(RESULTS)?.scrollTo({ top: 0 });
  };

  const dispose = (): void => {
    if (searchModal) {
      flag(searchModal, STALE, false);
      flag(searchModal, SEARCHING, false);
      announce(searchModal, rowsOf(searchModal), false, false);
    }
    unpaint();
    observer?.disconnect();
    observer = null;
    searchModal = null;
  };

  const adopt = (): void => {
    const topSearchModal = findTopSearchModal(doc);
    if (topSearchModal === searchModal) return;
    observer?.disconnect();
    observer = null;
    searchModal = topSearchModal;
    shownSignature = '';
    unpaint();
    if (!topSearchModal) return;
    observer = new MutationObserver(render);
    observer.observe(topSearchModal, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  };

  signals.subscribe(() => {
    render();
    if (!searchModal || !signals.isSearchPending()) return;
    runAfter(render, SLOW_SEARCH_MS);
    runAfter(render, MAX_PENDING_MS + EXPIRY_MARGIN_MS);
  });

  const syncView = (): void => {
    if (!isContextValid()) {
      dispose();
      return;
    }
    adopt();
    render();
  };

  const handleClick = (event: MouseEvent): void => {
    const openSearchModal = isContextValid() ? findTopSearchModal(doc) : null;
    const target = event.target;
    if (!openSearchModal || !(target instanceof Element) || !openSearchModal.contains(target)) return;
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && target.closest(RESULT_ROW)) {
      event.stopImmediatePropagation();
      return;
    }
    const pointed = event.detail > 0 && target.closest(REFOCUS_TRIGGER) !== null && doc.defaultView?.matchMedia(HOVER_MEDIA_QUERY).matches === true;
    runAfter(() => {
      syncView();
      if (pointed && isContextValid()) fieldOf(openSearchModal)?.focus({ preventScroll: true });
    }, 0);
  };

  return { syncView, handleClick, dispose };
}
