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

const STALE_ATTRIBUTE = 'data-senkutools-stale';
const SEARCHING_ATTRIBUTE = 'data-senkutools-searching';
const MATCH_HIGHLIGHT = 'senkutools-match';
const RESULTS_ID = 'senkutools-search-results';
const OPTION_ID = 'senkutools-search-option-';
const TAB_ID = 'senkutools-search-tab-';
const MIN_WORD_CHARACTERS = 2;
const SLOW_SEARCH_MS = 300;
const TIMER_SLACK_MS = 50;
const REFOCUS_TRIGGER = '.tabs-tab, .icon-click, .nav-search__cnt-space button';

export interface SearchView {
  syncView: () => void;
  handleClick: (event: MouseEvent) => void;
  dispose: () => void;
}

const setFlagAttribute = (element: HTMLElement, name: string, isOn: boolean): void => {
  if (element.hasAttribute(name) !== isOn) element.toggleAttribute(name, isOn);
};

const writeAttribute = (element: HTMLElement, name: string, attributeValue: string | null): void => {
  if (attributeValue === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== attributeValue) element.setAttribute(name, attributeValue);
};

const wordsOf = (query: string): string[] => [
  ...new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= MIN_WORD_CHARACTERS)
  ),
];

export function createSearchView(pageDocument: Document, { runAfter, isContextValid, signals }: SearchHost): SearchView {
  let searchModal: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let shownSignature = '';

  const matchRangesIn = (titles: HTMLElement[], words: string[]): Range[] => {
    const ranges: Range[] = [];
    for (const title of titles) {
      const textWalker = pageDocument.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
        const text = node.nodeValue ?? '';
        const lower = text.toLowerCase();
        if (lower.length !== text.length) continue;
        for (const word of words) {
          for (let matchStart = lower.indexOf(word); matchStart >= 0; matchStart = lower.indexOf(word, matchStart + word.length)) {
            const range = pageDocument.createRange();
            range.setStart(node, matchStart);
            range.setEnd(node, matchStart + word.length);
            ranges.push(range);
          }
        }
      }
    }
    return ranges;
  };

  const paint = (searchModal: HTMLElement, query: string): void => {
    const view = pageDocument.defaultView;
    if (!view?.CSS?.highlights || typeof view.Highlight !== 'function') return;
    const ranges = matchRangesIn([...searchModal.querySelectorAll<HTMLElement>(RESULT_TITLE)], wordsOf(query));
    if (ranges.length > 0) view.CSS.highlights.set(MATCH_HIGHLIGHT, new view.Highlight(...ranges));
    else view.CSS.highlights.delete(MATCH_HIGHLIGHT);
  };

  const writeAria = (searchModal: HTMLElement, rows: HTMLElement[], isShown: boolean, isManaged = true): void => {
    const active = rows.find((row) => row.classList.contains(ACTIVE_ROW_CLASS));
    const field = fieldOf(searchModal);
    if (field) {
      writeAttribute(field, 'role', isManaged ? 'combobox' : null);
      writeAttribute(field, 'aria-autocomplete', isManaged ? 'list' : null);
      writeAttribute(field, 'aria-expanded', isManaged ? String(isShown) : null);
      writeAttribute(field, 'aria-controls', isShown ? RESULTS_ID : null);
      writeAttribute(field, 'aria-activedescendant', isShown && active ? active.id : null);
    }
    searchModal.querySelectorAll<HTMLElement>(TAB).forEach((tab, index) => writeAttribute(tab, 'id', isManaged ? `${TAB_ID}${index}` : null));
    const results = searchModal.querySelector<HTMLElement>(RESULTS);
    if (results) {
      writeAttribute(results, 'role', isShown ? 'listbox' : null);
      writeAttribute(results, 'id', isShown ? RESULTS_ID : null);
      writeAttribute(results, 'aria-labelledby', isShown ? (searchModal.querySelector<HTMLElement>(ACTIVE_TAB)?.id ?? null) : null);
    }
    rows.forEach((row, index) => {
      writeAttribute(row, 'role', isShown ? 'option' : null);
      writeAttribute(row, 'id', isShown ? `${OPTION_ID}${index}` : null);
      writeAttribute(row, 'aria-selected', isShown ? String(row === active) : null);
    });
  };

  const unpaint = (): void => {
    pageDocument.defaultView?.CSS?.highlights?.delete(MATCH_HIGHLIGHT);
  };

  const render = (): void => {
    const openSearchModal = searchModal;
    if (!openSearchModal || !isContextValid()) return;
    const query = fieldOf(openSearchModal)?.value ?? '';
    const rows = rowsOf(openSearchModal);
    const isQueryTooShort = isTooShort(query);
    const isStale = isQueryTooShort && rows.length > 0;
    setFlagAttribute(openSearchModal, STALE_ATTRIBUTE, isStale);
    writeAria(openSearchModal, rows, rows.length > 0 && !isStale);
    setFlagAttribute(openSearchModal, SEARCHING_ATTRIBUTE, !isQueryTooShort && signals.waited() >= SLOW_SEARCH_MS);
    paint(openSearchModal, query);
    const signature = signatureOf(rows);
    if (signature === shownSignature) return;
    shownSignature = signature;
    openSearchModal.querySelector<HTMLElement>(RESULTS)?.scrollTo({ top: 0 });
  };

  const dispose = (): void => {
    if (searchModal) {
      setFlagAttribute(searchModal, STALE_ATTRIBUTE, false);
      setFlagAttribute(searchModal, SEARCHING_ATTRIBUTE, false);
      writeAria(searchModal, rowsOf(searchModal), false, false);
    }
    unpaint();
    observer?.disconnect();
    observer = null;
    searchModal = null;
  };

  const adoptTopModal = (): void => {
    const topSearchModal = findTopSearchModal(pageDocument);
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
    runAfter(render, SLOW_SEARCH_MS + TIMER_SLACK_MS);
    runAfter(render, MAX_PENDING_MS + TIMER_SLACK_MS);
  });

  const syncView = (): void => {
    if (!isContextValid()) {
      dispose();
      return;
    }
    adoptTopModal();
    render();
  };

  const handleClick = (event: MouseEvent): void => {
    const openSearchModal = isContextValid() ? findTopSearchModal(pageDocument) : null;
    const target = event.target;
    if (!openSearchModal || !(target instanceof Element) || !openSearchModal.contains(target)) return;
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && target.closest(RESULT_ROW)) {
      event.stopImmediatePropagation();
      return;
    }
    const isMouseClick = event instanceof PointerEvent && event.pointerType === 'mouse' && target.closest(REFOCUS_TRIGGER) !== null;
    runAfter(() => {
      syncView();
      if (isMouseClick && isContextValid()) fieldOf(openSearchModal)?.focus({ preventScroll: true });
    }, 0);
  };

  return { syncView, handleClick, dispose };
}
