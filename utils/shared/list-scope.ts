export type ListScope = 'grid' | 'picker';

export const LIST_SCOPES: readonly ListScope[] = ['grid', 'picker'];

export const isListScope = (candidate: unknown): candidate is ListScope => (LIST_SCOPES as readonly unknown[]).includes(candidate);
