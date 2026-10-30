import { defineSignal } from '../shared/signal';

export interface SearchSignal {
  phase: 'start' | 'done';
  query: string;
  type: string;
  settled?: boolean;
  firstSlug?: string | null;
}

export const searchSignal = defineSignal<SearchSignal>('senkutools:search', (detail) =>
  (detail.phase === 'start' || detail.phase === 'done') && typeof detail.query === 'string' ? (detail as unknown as SearchSignal) : null
);
