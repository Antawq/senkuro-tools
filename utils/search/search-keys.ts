import {
  ACTIVE,
  ANY_MODAL,
  EDITABLE,
  FIELD,
  MIN_QUERY_LENGTH,
  MODAL,
  OPEN_BUTTON,
  TAB_ACTIVE,
  fieldOf as fieldIn,
  rowsOf as rowsIn,
  topModal,
} from './search-dom';
import type { SearchSignals } from './search-signal';

const CONTROL = 'button, a, input, select, textarea, [contenteditable], [role="button"], [role="radio"]';
const DEBOUNCE_MS = 250;
const PAINT_MS = 60;
const SETTLE_MS = 900;
const GIVE_UP_MS = 3000;
const HANDLED_KEYS = new Set(['Enter', 'ArrowDown', 'ArrowUp']);
const HANDLED_CODES = new Set(['Enter', 'NumpadEnter', 'ArrowDown', 'ArrowUp']);
const IME_KEY_CODE = 229;

export interface SearchKeysHost {
  later: (run: () => void, ms: number) => void;
  alive: () => boolean;
  signals: SearchSignals;
}

export interface SearchKeys {
  keydown: (event: KeyboardEvent) => void;
  input: (event: Event) => void;
  dispose: () => void;
}

const signatureOf = (rows: HTMLElement[]): string => rows.map((row) => row.getAttribute('href') ?? '').join('|');

const sameElements = (left: HTMLElement[], right: HTMLElement[]): boolean =>
  left.length === right.length && left.every((row, position) => row === right[position]);

const isModified = (event: KeyboardEvent): boolean => event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

const isComposing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === IME_KEY_CODE;

const isSearchHotkey = (event: KeyboardEvent): boolean => event.ctrlKey && event.code === 'KeyK';

const isOpenKey = (event: KeyboardEvent): boolean =>
  event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !isComposing(event);

const isNewTabEnter = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === 'Enter' && !isComposing(event);

const askedOf = (modal: HTMLElement): string => JSON.stringify([fieldIn(modal)?.value, modal.querySelector(TAB_ACTIVE)?.textContent]);

const take = (event: Event): void => {
  event.preventDefault();
  event.stopImmediatePropagation();
};

export function createSearchKeys(doc: Document, { later, alive, signals }: SearchKeysHost): SearchKeys {
  const spent = new WeakSet<HTMLElement>();
  let session: HTMLElement | null = null;
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

  const openModal = (): HTMLElement | null => topModal(doc, (modal) => spent.has(modal));

  const fieldOf = (): HTMLInputElement | null => (session ? fieldIn(session) : null);
  const rowsOf = (): HTMLElement[] => (session ? rowsIn(session) : []);
  const mark = (rows: HTMLElement[]): void => rows.forEach((row, position) => row.classList.toggle(ACTIVE, position === index));

  const refresh = (): HTMLElement[] => {
    const rows = rowsOf();
    const signature = signatureOf(rows);
    if (signature !== shownSignature) {
      shownSignature = signature;
      changedAt = Date.now();
    }
    if (!sameElements(rows, shownRows)) {
      shownRows = rows;
      index = null;
      mark(rows);
    }
    return rows;
  };

  const isFresh = (): boolean => {
    const sinceTyped = Date.now() - typedAt;
    if (!signals.live()) return changedAt >= typedAt + DEBOUNCE_MS || sinceTyped >= SETTLE_MS;
    return sinceTyped >= DEBOUNCE_MS && !signals.pending() && Date.now() - signals.doneAt() >= PAINT_MS;
  };

  const noticeTyping = (): void => {
    const value = fieldOf()?.value ?? '';
    if (value === knownValue) return;
    knownValue = value;
    typedAt = Date.now();
    index = null;
    mark(rowsOf());
  };

  const check = (startedAt: number, owner: HTMLElement): void => {
    if (!waiting || startedAt !== waitStartedAt) return;
    if (session !== owner || openModal() !== owner || askedOf(owner) !== waitAsked) {
      waiting = false;
      return;
    }
    const rows = refresh();
    if (rows.length > 0 && isFresh()) {
      waiting = false;
      const row = rows[index ?? 0];
      if (waitNewTab) row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView, ...waitNewTab }));
      else {
        spent.add(owner);
        row?.click();
      }
      return;
    }
    if (Date.now() - startedAt >= GIVE_UP_MS) waiting = false;
  };

  const adopt = (): HTMLElement | null => {
    const found = openModal();
    if (found === session) return found;
    observer?.disconnect();
    observer = null;
    session = found;
    waiting = false;
    index = null;
    shownRows = [];
    shownSignature = '';
    changedAt = Date.now();
    typedAt = 0;
    knownValue = '';
    if (found) {
      observer = new MutationObserver(() => {
        refresh();
        check(waitStartedAt, found);
      });
      observer.observe(found, { childList: true, subtree: true });
    }
    return found;
  };

  const wait = (owner: HTMLElement, newTab: { ctrlKey: boolean; metaKey: boolean } | null): void => {
    waiting = true;
    waitNewTab = newTab;
    waitAsked = askedOf(owner);
    waitStartedAt = Date.now();
    const started = waitStartedAt;
    check(started, owner);
    if (!waiting) return;
    later(() => check(started, owner), Math.max(0, typedAt + DEBOUNCE_MS - started) + PAINT_MS);
    later(() => check(started, owner), Math.max(0, typedAt + SETTLE_MS - started));
    later(() => check(started, owner), GIVE_UP_MS);
  };

  signals.subscribe(() => {
    const owner = session;
    if (!waiting || !owner) return;
    const started = waitStartedAt;
    check(started, owner);
    if (waiting) later(() => check(started, owner), PAINT_MS);
  });

  const step = (rows: HTMLElement[], delta: number): void => {
    index = index === null ? 0 : Math.min(Math.max(index + delta, 0), rows.length - 1);
    mark(rows);
    rows[index]?.scrollIntoView({ block: 'nearest' });
  };

  const owns = (target: EventTarget | null, modal: HTMLElement): boolean =>
    target === doc.body || target === doc.documentElement || (target instanceof Node && modal.contains(target));

  const dispose = (): void => {
    index = null;
    mark(rowsOf());
    observer?.disconnect();
    observer = null;
    session = null;
    waiting = false;
  };

  return {
    keydown(event) {
      if (!alive()) {
        dispose();
        return;
      }
      if (isOpenKey(event)) {
        const opener = doc.querySelector<HTMLElement>(OPEN_BUTTON);
        if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
        if (!opener || doc.querySelector(ANY_MODAL)) return;
        take(event);
        opener.click();
        return;
      }
      if (isSearchHotkey(event)) {
        const open = adopt();
        if (!open) return;
        take(event);
        const field = fieldIn(open);
        field?.focus();
        field?.select();
        return;
      }
      const newTab = isNewTabEnter(event);
      const aside = !newTab && (isComposing(event) || isModified(event));
      if (!HANDLED_KEYS.has(event.key) && !(aside && HANDLED_CODES.has(event.code))) return;
      const modal = adopt();
      if (aside) {
        if (modal && owns(event.target, modal)) event.stopImmediatePropagation();
        return;
      }
      if (!modal || !owns(event.target, modal)) return;
      const onControl = event.target instanceof HTMLElement && !event.target.matches(FIELD) && event.target.closest(CONTROL) !== null;
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
      if (waiting || (fieldOf()?.value.trim().length ?? 0) < MIN_QUERY_LENGTH) return;
      wait(modal, newTab ? { ctrlKey: event.ctrlKey, metaKey: event.metaKey } : null);
    },
    input(event) {
      if (!alive() || !(event.target instanceof HTMLElement) || !event.target.matches(`${MODAL} ${FIELD}`)) return;
      if (adopt()) noticeTyping();
    },
    dispose,
  };
}
