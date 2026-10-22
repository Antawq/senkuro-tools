export const SEARCH_EVENT = 'senkutools:search';

const MAX_PENDING_MS = 5000;

export interface SearchSignal {
  phase: 'start' | 'done';
  query: string;
  type: string;
}

export interface SearchSignals {
  event: (event: Event) => void;
  subscribe: (listener: () => void) => void;
  live: () => boolean;
  pending: () => boolean;
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
  let seen = false;
  let lastDone = 0;

  return {
    event(event) {
      const signal = parse(event);
      if (!signal) return;
      seen = true;
      if (signal.phase === 'start') starts.push(now());
      else {
        starts.shift();
        lastDone = now();
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => void listeners.push(listener),
    live: () => seen,
    pending: () => starts.some((startedAt) => now() - startedAt < MAX_PENDING_MS),
    doneAt: () => lastDone,
  };
}
