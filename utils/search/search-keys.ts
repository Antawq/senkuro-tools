import { MODAL_CONTENT_SELECTOR } from '../shared/modal-selectors';
import {
  ACTIVE_ROW_CLASS,
  ACTIVE_TAB,
  EDITABLE,
  OPEN_BUTTON,
  SEARCH_FIELD,
  SEARCH_MODAL,
  canSiteOpenCatalog,
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
  handleKeydown: (event: KeyboardEvent) => void;
  handleInput: (event: Event) => void;
  dispose: () => void;
}

const hasSameElements = (left: HTMLElement[], right: HTMLElement[]): boolean =>
  left.length === right.length && left.every((row, position) => row === right[position]);

const isModified = (event: KeyboardEvent): boolean => event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

const isComposing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === IME_KEY_CODE;

const isSearchHotkey = (event: KeyboardEvent): boolean => event.ctrlKey && event.code === 'KeyK';

const isOpenKey = (event: KeyboardEvent): boolean =>
  event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !isComposing(event);

const isNewTabEnter = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === 'Enter' && !isComposing(event);

const askedOf = (searchModal: HTMLElement): string => JSON.stringify([fieldOf(searchModal)?.value, searchModal.querySelector(ACTIVE_TAB)?.textContent]);

const consumeEvent = (event: Event): void => {
  event.preventDefault();
  event.stopImmediatePropagation();
};

export function createSearchKeys(pageDocument: Document, { runAfter, isContextValid, signals }: SearchHost): SearchKeys {
  const spentSearchModals = new WeakSet<HTMLElement>();
  let searchModal: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let index: number | null = null;
  let shownRows: HTMLElement[] = [];
  let shownSignature = '';
  let changedAt = 0;
  let typedAt = 0;
  let knownFieldValue = '';
  let isWaiting = false;
  let waitStartedAt = 0;
  let waitAsked = '';
  let waitNewTabKeys: { ctrlKey: boolean; metaKey: boolean } | null = null;
  let didMoveBeforeAnswer = false;

  const findUnspentSearchModal = (): HTMLElement | null => findTopSearchModal(pageDocument, (searchModal) => spentSearchModals.has(searchModal));

  const currentField = (): HTMLInputElement | null => (searchModal ? fieldOf(searchModal) : null);
  const currentRows = (): HTMLElement[] => (searchModal ? rowsOf(searchModal) : []);
  const markActiveRow = (rows: HTMLElement[]): void => rows.forEach((row, position) => row.classList.toggle(ACTIVE_ROW_CLASS, position === index));

  const syncRows = (): HTMLElement[] => {
    const rows = currentRows();
    const signature = signatureOf(rows);
    if (signature !== shownSignature) {
      shownSignature = signature;
      changedAt = Date.now();
    }
    if (!hasSameElements(rows, shownRows)) {
      shownRows = rows;
      if (rows.length > 0 || !didMoveBeforeAnswer) {
        index = didMoveBeforeAnswer && index !== null ? Math.min(index, rows.length - 1) : null;
        didMoveBeforeAnswer = false;
      }
      markActiveRow(rows);
    }
    return rows;
  };

  const isFresh = (): boolean => {
    const sinceTyped = Date.now() - typedAt;
    if (!signals.hasSeenSignal()) return changedAt >= typedAt + DEBOUNCE_MS || sinceTyped >= SETTLE_MS;
    return sinceTyped >= DEBOUNCE_MS && !signals.isSearchPending() && Date.now() - signals.doneAt() >= PAINT_MS;
  };

  const noticeTyping = (): void => {
    const fieldValue = currentField()?.value ?? '';
    if (fieldValue === knownFieldValue) return;
    knownFieldValue = fieldValue;
    typedAt = Date.now();
    index = null;
    markActiveRow(currentRows());
  };

  const openResultIfReady = (startedAt: number, waitModal: HTMLElement): void => {
    if (!isWaiting || startedAt !== waitStartedAt) return;
    if (searchModal !== waitModal || findUnspentSearchModal() !== waitModal || askedOf(waitModal) !== waitAsked) {
      isWaiting = false;
      return;
    }
    const rows = syncRows();
    if (rows.length > 0 && isFresh()) {
      isWaiting = false;
      const row = rows[index ?? 0];
      if (waitNewTabKeys) row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: pageDocument.defaultView, ...waitNewTabKeys }));
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
    isWaiting = false;
    index = null;
    shownRows = [];
    shownSignature = '';
    changedAt = Date.now();
    typedAt = 0;
    knownFieldValue = '';
    if (topSearchModal) {
      observer = new MutationObserver(() => {
        syncRows();
        openResultIfReady(waitStartedAt, topSearchModal);
      });
      observer.observe(topSearchModal, { childList: true, subtree: true });
    }
    return topSearchModal;
  };

  const startWait = (waitModal: HTMLElement, newTabKeys: { ctrlKey: boolean; metaKey: boolean } | null): void => {
    isWaiting = true;
    waitNewTabKeys = newTabKeys;
    waitAsked = askedOf(waitModal);
    waitStartedAt = Date.now();
    const startedAt = waitStartedAt;
    openResultIfReady(startedAt, waitModal);
    if (!isWaiting) return;
    runAfter(() => openResultIfReady(startedAt, waitModal), Math.max(0, typedAt + DEBOUNCE_MS - startedAt) + PAINT_MS);
    runAfter(() => openResultIfReady(startedAt, waitModal), Math.max(0, typedAt + SETTLE_MS - startedAt));
    runAfter(() => {
      openResultIfReady(startedAt, waitModal);
      if (startedAt === waitStartedAt) isWaiting = false;
    }, GIVE_UP_MS);
  };

  signals.subscribe(() => {
    const waitModal = searchModal;
    if (!isWaiting || !waitModal) return;
    const startedAt = waitStartedAt;
    openResultIfReady(startedAt, waitModal);
    if (isWaiting) runAfter(() => openResultIfReady(startedAt, waitModal), PAINT_MS);
  });

  const moveActiveRow = (rows: HTMLElement[], delta: number): void => {
    didMoveBeforeAnswer = !isFresh();
    index = index === null ? 0 : Math.min(Math.max(index + delta, 0), rows.length - 1);
    markActiveRow(rows);
    rows[index]?.scrollIntoView({ block: 'nearest' });
  };

  const isModalTarget = (target: EventTarget | null, searchModal: HTMLElement): boolean =>
    target === pageDocument.body || target === pageDocument.documentElement || (target instanceof Node && searchModal.contains(target));

  const dispose = (): void => {
    index = null;
    markActiveRow(currentRows());
    observer?.disconnect();
    observer = null;
    searchModal = null;
    isWaiting = false;
  };

  return {
    handleKeydown(event) {
      if (!isContextValid()) {
        dispose();
        return;
      }
      if (isOpenKey(event)) {
        const opener = pageDocument.querySelector<HTMLElement>(OPEN_BUTTON);
        if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
        if (!opener || pageDocument.querySelector(MODAL_CONTENT_SELECTOR)) return;
        consumeEvent(event);
        opener.click();
        return;
      }
      if (isSearchHotkey(event)) {
        const openSearchModal = adoptTopModal();
        if (!openSearchModal) return;
        consumeEvent(event);
        const field = fieldOf(openSearchModal);
        field?.focus();
        field?.select();
        return;
      }
      const isNewTab = isNewTabEnter(event);
      const shouldOnlyStop = !isNewTab && (isComposing(event) || isModified(event));
      if (!HANDLED_KEYS.has(event.key) && !(shouldOnlyStop && HANDLED_CODES.has(event.code))) return;
      const topSearchModal = adoptTopModal();
      if (shouldOnlyStop) {
        if (topSearchModal && isModalTarget(event.target, topSearchModal)) event.stopImmediatePropagation();
        return;
      }
      if (!topSearchModal || !isModalTarget(event.target, topSearchModal)) return;
      const isControlTarget = event.target instanceof HTMLElement && !event.target.matches(SEARCH_FIELD) && event.target.closest(CONTROL) !== null;
      if (isControlTarget) {
        event.stopImmediatePropagation();
        return;
      }
      const isPlainEnter = event.key === 'Enter' && !isNewTab && index === null;
      if (isPlainEnter && !isTooShort(fieldOf(topSearchModal)?.value ?? '') && canSiteOpenCatalog(topSearchModal, pageDocument)) return;
      consumeEvent(event);
      noticeTyping();
      const rows = syncRows();
      if (event.key !== 'Enter') {
        if (rows.length > 0) moveActiveRow(rows, event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (isWaiting || isTooShort(currentField()?.value ?? '')) return;
      startWait(topSearchModal, isNewTab ? { ctrlKey: event.ctrlKey, metaKey: event.metaKey } : null);
    },
    handleInput(event) {
      if (!isContextValid() || !(event.target instanceof HTMLElement) || !event.target.matches(`${SEARCH_MODAL} ${SEARCH_FIELD}`)) return;
      if (adoptTopModal()) noticeTyping();
    },
    dispose,
  };
}
