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

const parseSignal = (event: Event): SearchSignal | null => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'string') return null;
  try {
    const signal = JSON.parse(detail) as Partial<SearchSignal>;
    return (signal.phase === 'start' || signal.phase === 'done') && typeof signal.query === 'string' ? (signal as SearchSignal) : null;
  } catch {
    return null;
  }
};

export function createSearchSignals(readClock: () => number = Date.now): SearchSignals {
  const listeners: (() => void)[] = [];
  const startTimes: number[] = [];
  let hasReceivedSignal = false;
  let lastDoneAt = 0;

  return {
    handleEvent(event) {
      const signal = parseSignal(event);
      if (!signal) return;
      hasReceivedSignal = true;
      if (signal.phase === 'start') startTimes.push(readClock());
      else {
        startTimes.shift();
        lastDoneAt = readClock();
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => void listeners.push(listener),
    hasSeenSignal: () => hasReceivedSignal,
    isSearchPending: () => startTimes.some((startTime) => readClock() - startTime < MAX_PENDING_MS),
    waited() {
      const oldestStartTime = startTimes.find((startTime) => readClock() - startTime < MAX_PENDING_MS);
      return oldestStartTime === undefined ? 0 : readClock() - oldestStartTime;
    },
    doneAt: () => lastDoneAt,
  };
}
