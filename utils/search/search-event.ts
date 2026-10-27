export const SEARCH_EVENT = 'senkutools:search';

export interface SearchSignal {
  phase: 'start' | 'done';
  query: string;
  type: string;
  settled?: boolean;
  firstSlug?: string | null;
}

export const parseSearchSignal = (event: Event): SearchSignal | null => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'string') return null;
  try {
    const signal = JSON.parse(detail) as Partial<SearchSignal>;
    return (signal.phase === 'start' || signal.phase === 'done') && typeof signal.query === 'string' ? (signal as SearchSignal) : null;
  } catch {
    return null;
  }
};
