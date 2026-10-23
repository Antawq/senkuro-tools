import { MODAL_CONTENT_SELECTOR } from '../shared/modal-selectors';
import {
  ACTIVE_ROW_CLASS,
  ACTIVE_TAB,
  EDITABLE,
  OPEN_BUTTON,
  SEARCH_FIELD,
  SEARCH_MODAL,
  fieldOf,
  findTopSearchModal,
  isTooShort,
  rowsOf,
  signatureOf,
  type SearchHost,
} from './search-dom';

const CONTROL = 'button, a, input, select, textarea, [contenteditable], [role="button"], [role="radio"]';
const DEBOUNCE_MS = 250;
const PAINT_MS = 60;
const SETTLE_MS = 900;
const GIVE_UP_MS = 3000;
const HANDLED_KEYS = new Set(['Enter', 'ArrowDown', 'ArrowUp']);
const HANDLED_CODES = new Set(['Enter', 'NumpadEnter', 'ArrowDown', 'ArrowUp']);
const IME_KEY_CODE = 229;

export interface SearchKeys {
  keydown: (event: KeyboardEvent) => void;
  input: (event: Event) => void;
  dispose: () => void;
}

const sameElements = (left: HTMLElement[], right: HTMLElement[]): boolean =>
  left.length === right.length && left.every((row, position) => row === right[position]);

const isModified = (event: KeyboardEvent): boolean => event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

const isComposing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === IME_KEY_CODE;

const isSearchHotkey = (event: KeyboardEvent): boolean => event.ctrlKey && event.code === 'KeyK';

const isOpenKey = (event: KeyboardEvent): boolean =>
  event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !isComposing(event);

const isNewTabEnter = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === 'Enter' && !isComposing(event);

const askedOf = (searchModal: HTMLElement): string => JSON.stringify([fieldOf(searchModal)?.value, searchModal.querySelector(ACTIVE_TAB)?.textContent]);

const take = (event: Event): void => {
  event.preventDefault();
  event.stopImmediatePropagation();
};

export function createSearchKeys(doc: Document, { runAfter, isContextValid, signals }: SearchHost): SearchKeys {
  const spentSearchModals = new WeakSet<HTMLElement>();
  let searchModal: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let index: number | null = null;
  let shownRows: HTMLElement[] = [];
  let shownSignature = '';
  let changedAt = 0;
  let typedAt = 0;
  let knownValue = '';
  let waiting = false;
  let waitStartedAt = 0;
  let waitAsked = '';
  let waitNewTab: { ctrlKey: boolean; metaKey: boolean } | null = null;
  let steppedBeforeAnswer = false;

  const findUnspentSearchModal = (): HTMLElement | null => findTopSearchModal(doc, (searchModal) => spentSearchModals.has(searchModal));

  const currentField = (): HTMLInputElement | null => (searchModal ? fieldOf(searchModal) : null);
  const currentRows = (): HTMLElement[] => (searchModal ? rowsOf(searchModal) : []);
  const mark = (rows: HTMLElement[]): void => rows.forEach((row, position) => row.classList.toggle(ACTIVE_ROW_CLASS, position === index));

  const refresh = (): HTMLElement[] => {
    const rows = currentRows();
    const signature = signatureOf(rows);
    if (signature !== shownSignature) {
      shownSignature = signature;
      changedAt = Date.now();
    }
    if (!sameElements(rows, shownRows)) {
      shownRows = rows;
      if (rows.length > 0 || !steppedBeforeAnswer) {
        index = steppedBeforeAnswer && index !== null ? Math.min(index, rows.length - 1) : null;
        steppedBeforeAnswer = false;
      }
      mark(rows);
    }
    return rows;
  };

  const isFresh = (): boolean => {
    const sinceTyped = Date.now() - typedAt;
    if (!signals.hasSeenSignal()) return changedAt >= typedAt + DEBOUNCE_MS || sinceTyped >= SETTLE_MS;
    return sinceTyped >= DEBOUNCE_MS && !signals.isSearchPending() && Date.now() - signals.doneAt() >= PAINT_MS;
  };

  const noticeTyping = (): void => {
    const value = currentField()?.value ?? '';
    if (value === knownValue) return;
    knownValue = value;
    typedAt = Date.now();
    index = null;
    mark(currentRows());
  };

  const openResultIfReady = (startedAt: number, waitModal: HTMLElement): void => {
    if (!waiting || startedAt !== waitStartedAt) return;
    if (searchModal !== waitModal || findUnspentSearchModal() !== waitModal || askedOf(waitModal) !== waitAsked) {
      waiting = false;
      return;
    }
    const rows = refresh();
    if (rows.length > 0 && isFresh()) {
      waiting = false;
      const row = rows[index ?? 0];
      if (waitNewTab) row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView, ...waitNewTab }));
      else {
        spentSearchModals.add(waitModal);
        row?.click();
      }
      return;
    }
  };

  const adoptTopModal = (): HTMLElement | null => {
    const topSearchModal = findUnspentSearchModal();
    if (topSearchModal === searchModal) return topSearchModal;
    observer?.disconnect();
    observer = null;
    searchModal = topSearchModal;
    waiting = false;
    index = null;
    shownRows = [];
    shownSignature = '';
    changedAt = Date.now();
    typedAt = 0;
    knownValue = '';
    if (topSearchModal) {
      observer = new MutationObserver(() => {
        refresh();
        openResultIfReady(waitStartedAt, topSearchModal);
      });
      observer.observe(topSearchModal, { childList: true, subtree: true });
    }
    return topSearchModal;
  };

  const startWait = (waitModal: HTMLElement, newTab: { ctrlKey: boolean; metaKey: boolean } | null): void => {
    waiting = true;
    waitNewTab = newTab;
    waitAsked = askedOf(waitModal);
    waitStartedAt = Date.now();
    const started = waitStartedAt;
    openResultIfReady(started, waitModal);
    if (!waiting) return;
    runAfter(() => openResultIfReady(started, waitModal), Math.max(0, typedAt + DEBOUNCE_MS - started) + PAINT_MS);
    runAfter(() => openResultIfReady(started, waitModal), Math.max(0, typedAt + SETTLE_MS - started));
    runAfter(() => {
      openResultIfReady(started, waitModal);
      if (started === waitStartedAt) waiting = false;
    }, GIVE_UP_MS);
  };

  signals.subscribe(() => {
    const waitModal = searchModal;
    if (!waiting || !waitModal) return;
    const started = waitStartedAt;
    openResultIfReady(started, waitModal);
    if (waiting) runAfter(() => openResultIfReady(started, waitModal), PAINT_MS);
  });

  const step = (rows: HTMLElement[], delta: number): void => {
    steppedBeforeAnswer = !isFresh();
    index = index === null ? 0 : Math.min(Math.max(index + delta, 0), rows.length - 1);
    mark(rows);
    rows[index]?.scrollIntoView({ block: 'nearest' });
  };

  const isModalTarget = (target: EventTarget | null, searchModal: HTMLElement): boolean =>
    target === doc.body || target === doc.documentElement || (target instanceof Node && searchModal.contains(target));

  const dispose = (): void => {
    index = null;
    mark(currentRows());
    observer?.disconnect();
    observer = null;
    searchModal = null;
    waiting = false;
  };

  return {
    keydown(event) {
      if (!isContextValid()) {
        dispose();
        return;
      }
      if (isOpenKey(event)) {
        const opener = doc.querySelector<HTMLElement>(OPEN_BUTTON);
        if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
        if (!opener || doc.querySelector(MODAL_CONTENT_SELECTOR)) return;
        take(event);
        opener.click();
        return;
      }
      if (isSearchHotkey(event)) {
        const openSearchModal = adoptTopModal();
        if (!openSearchModal) return;
        take(event);
        const field = fieldOf(openSearchModal);
        field?.focus();
        field?.select();
        return;
      }
      const newTab = isNewTabEnter(event);
      const aside = !newTab && (isComposing(event) || isModified(event));
      if (!HANDLED_KEYS.has(event.key) && !(aside && HANDLED_CODES.has(event.code))) return;
      const topSearchModal = adoptTopModal();
      if (aside) {
        if (topSearchModal && isModalTarget(event.target, topSearchModal)) event.stopImmediatePropagation();
        return;
      }
      if (!topSearchModal || !isModalTarget(event.target, topSearchModal)) return;
      const onControl = event.target instanceof HTMLElement && !event.target.matches(SEARCH_FIELD) && event.target.closest(CONTROL) !== null;
      if (onControl) {
        event.stopImmediatePropagation();
        return;
      }
      take(event);
      noticeTyping();
      const rows = refresh();
      if (event.key !== 'Enter') {
        if (rows.length > 0) step(rows, event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (waiting || isTooShort(currentField()?.value ?? '')) return;
      startWait(topSearchModal, newTab ? { ctrlKey: event.ctrlKey, metaKey: event.metaKey } : null);
    },
    input(event) {
      if (!isContextValid() || !(event.target instanceof HTMLElement) || !event.target.matches(`${SEARCH_MODAL} ${SEARCH_FIELD}`)) return;
      if (adoptTopModal()) noticeTyping();
    },
    dispose,
  };
}
