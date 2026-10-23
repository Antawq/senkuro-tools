export const LIST_LOAD_EVENT = 'senkutools:list-load';
export const LIST_LOADED_EVENT = 'senkutools:list-loaded';

export type LoadOutcome = 'complete' | 'partial' | 'moved';

const OUTCOMES: readonly unknown[] = ['complete', 'partial', 'moved'];

export const encodeLoaded = (outcome: LoadOutcome): string => JSON.stringify({ outcome });

export function readLoaded(event: Event): LoadOutcome | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'string') return null;
  try {
    const { outcome } = JSON.parse(detail) as { outcome?: unknown };
    return OUTCOMES.includes(outcome) ? (outcome as LoadOutcome) : null;
  } catch {
    return null;
  }
}
