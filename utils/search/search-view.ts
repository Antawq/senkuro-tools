import { LIST, fieldOf, isTooShort, rowsOf, topModal } from './search-dom';
import { MAX_PENDING_MS, type SearchSignals } from './search-signal';

const STALE = 'data-stale';
const SEARCHING = 'data-searching';
const SLOW_SEARCH_MS = 300;

export interface SearchViewHost {
  later: (run: () => void, ms: number) => void;
  alive: () => boolean;
  signals: SearchSignals;
}

export interface SearchView {
  touch: () => void;
  dispose: () => void;
}

const flag = (element: HTMLElement, name: string, on: boolean): void => {
  if (element.hasAttribute(name) !== on) element.toggleAttribute(name, on);
};

const signatureOf = (rows: HTMLElement[]): string => rows.map((row) => row.getAttribute('href') ?? '').join('|');

export function createSearchView(doc: Document, { later, alive, signals }: SearchViewHost): SearchView {
  let session: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let shownSignature = '';

  const render = (): void => {
    const modal = session;
    if (!modal || !alive()) return;
    const query = fieldOf(modal)?.value ?? '';
    const rows = rowsOf(modal);
    const tooShort = isTooShort(query);
    flag(modal, STALE, tooShort && rows.length > 0);
    flag(modal, SEARCHING, !tooShort && signals.waited() >= SLOW_SEARCH_MS);
    const signature = signatureOf(rows);
    if (signature === shownSignature) return;
    shownSignature = signature;
    modal.querySelector<HTMLElement>(LIST)?.scrollTo({ top: 0, behavior: 'instant' });
  };

  const dispose = (): void => {
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
    if (!found) return;
    observer = new MutationObserver(render);
    observer.observe(found, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  };

  signals.subscribe(() => {
    render();
    if (!session || !signals.pending()) return;
    later(render, SLOW_SEARCH_MS);
    later(render, MAX_PENDING_MS + 50);
  });

  return {
    touch() {
      if (!alive()) {
        dispose();
        return;
      }
      adopt();
      render();
    },
    dispose,
  };
}
