const MODAL = '.modal-content--search';
const FIELD = 'input.input-el';
const ROW = '[data-index]';
const ACTIVE = 'card-search--active';
const CONTROL = 'button, a, input, select, textarea, [role="button"], [role="radio"]';
const MIN_QUERY_LENGTH = 2;
const SETTLE_MS = 900;
const GIVE_UP_MS = 3000;
const RETRY_MS = 100;

export interface SearchKeys {
  keydown: (event: KeyboardEvent) => void;
  input: (event: Event) => void;
}

type Later = (run: () => void, ms: number) => void;

const signatureOf = (rows: HTMLElement[]): string => rows.map((row) => row.getAttribute('href') ?? '').join('|');

const isModified = (event: KeyboardEvent): boolean => event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

const isSearchField = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.matches(FIELD) || target.closest(CONTROL) === null);

const take = (event: Event): void => {
  event.preventDefault();
  event.stopImmediatePropagation();
};

export function createSearchKeys(doc: Document, later: Later): SearchKeys {
  let index: number | null = null;
  let seen = '';
  let typedAt = 0;
  let typedWith = '';
  let waiting = false;

  const modal = (): HTMLElement | null => doc.querySelector<HTMLElement>(MODAL);
  const rowsOf = (): HTMLElement[] => [...(modal()?.querySelectorAll<HTMLElement>(ROW) ?? [])];
  const queryOf = (): string => modal()?.querySelector<HTMLInputElement>(FIELD)?.value.trim() ?? '';
  const mark = (rows: HTMLElement[]): void => rows.forEach((row, position) => row.classList.toggle(ACTIVE, position === index));

  const current = (): HTMLElement[] => {
    const rows = rowsOf();
    const signature = signatureOf(rows);
    if (signature !== seen) {
      seen = signature;
      index = null;
      mark(rows);
    }
    return rows;
  };

  const isFresh = (rows: HTMLElement[]): boolean => signatureOf(rows) !== typedWith || Date.now() - typedAt >= SETTLE_MS;

  const awaitResults = (startedAt: number): void => {
    if (!modal()) {
      waiting = false;
      return;
    }
    const rows = current();
    if (rows.length > 0 && isFresh(rows)) {
      waiting = false;
      rows[index ?? 0]?.click();
      return;
    }
    if (Date.now() - startedAt >= GIVE_UP_MS) {
      waiting = false;
      return;
    }
    later(() => awaitResults(startedAt), RETRY_MS);
  };

  const step = (rows: HTMLElement[], delta: number): void => {
    index = index === null ? 0 : Math.min(Math.max(index + delta, 0), rows.length - 1);
    mark(rows);
    rows[index]?.scrollIntoView({ block: 'nearest' });
  };

  return {
    keydown(event) {
      if (isModified(event) || !modal() || !isSearchField(event.target)) return;
      const rows = current();
      if (event.key === 'Enter') {
        if (rows.length === 0 && queryOf().length < MIN_QUERY_LENGTH) return;
        take(event);
        if (waiting) return;
        waiting = true;
        awaitResults(Date.now());
      } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length > 0) {
        take(event);
        step(rows, event.key === 'ArrowDown' ? 1 : -1);
      }
    },
    input(event) {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(`${MODAL} ${FIELD}`)) return;
      typedAt = Date.now();
      typedWith = signatureOf(rowsOf());
      index = null;
      mark(rowsOf());
    },
  };
}
