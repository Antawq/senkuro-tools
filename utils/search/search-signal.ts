import { parseSearchSignal } from './search-event';

export const MAX_PENDING_MS = 5000;

export interface SettledSearch {
  query: string;
  firstSlug: string | null;
}

export interface SearchSignals {
  handleEvent: (event: Event) => void;
  subscribe: (listener: () => void) => void;
  hasSeenSignal: () => boolean;
  isSearchPending: () => boolean;
  waited: () => number;
  lastSettled: () => SettledSearch | null;
}

export function createSearchSignals(readClock: () => number = Date.now): SearchSignals {
  const listeners: (() => void)[] = [];
  const startTimes: number[] = [];
  let hasReceivedSignal = false;
  let lastSettled: SettledSearch | null = null;

  return {
    handleEvent(event) {
      const signal = parseSearchSignal(event);
      if (!signal) return;
      hasReceivedSignal = true;
      if (signal.phase === 'start') startTimes.push(readClock());
      else {
        startTimes.shift();
        if (signal.settled === true) lastSettled = { query: signal.query, firstSlug: typeof signal.firstSlug === 'string' ? signal.firstSlug : null };
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
    lastSettled: () => lastSettled,
  };
}
