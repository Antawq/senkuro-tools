import { defineSignal } from '../shared/signal';

export interface SearchProgress {
  phase: 'start' | 'done';
  query: string;
  type: string;
  settled?: boolean;
  firstSlug?: string | null;
}

export const searchSignal = defineSignal<SearchProgress>('senkutools:search', (detail) =>
  (detail.phase === 'start' || detail.phase === 'done') && typeof detail.query === 'string' ? (detail as unknown as SearchProgress) : null
);
