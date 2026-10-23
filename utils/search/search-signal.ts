export const SEARCH_EVENT = 'senkutools:search';

export const MAX_PENDING_MS = 5000;

export interface SearchSignal {
  phase: 'start' | 'done';
  query: string;
  type: string;
}

export interface SearchSignals {
  handleEvent: (event: Event) => void;
  subscribe: (listener: () => void) => void;
  hasSeenSignal: () => boolean;
  isSearchPending: () => boolean;
  waited: () => number;
  doneAt: () => number;
}

const parse = (event: Event): SearchSignal | null => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'string') return null;
  try {
    const signal = JSON.parse(detail) as Partial<SearchSignal>;
    return (signal.phase === 'start' || signal.phase === 'done') && typeof signal.query === 'string' ? (signal as SearchSignal) : null;
  } catch {
    return null;
  }
};

export function createSearchSignals(now: () => number = Date.now): SearchSignals {
  const listeners: (() => void)[] = [];
  const starts: number[] = [];
  let hasReceivedSignal = false;
  let lastDone = 0;

  return {
    handleEvent(event) {
      const signal = parse(event);
      if (!signal) return;
      hasReceivedSignal = true;
      if (signal.phase === 'start') starts.push(now());
      else {
        starts.shift();
        lastDone = now();
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => void listeners.push(listener),
    hasSeenSignal: () => hasReceivedSignal,
    isSearchPending: () => starts.some((startedAt) => now() - startedAt < MAX_PENDING_MS),
    waited() {
      const oldest = starts.find((startedAt) => now() - startedAt < MAX_PENDING_MS);
      return oldest === undefined ? 0 : now() - oldest;
    },
    doneAt: () => lastDone,
  };
}
