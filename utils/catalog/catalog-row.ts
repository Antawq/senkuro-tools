export type CatalogRow = Record<string, unknown>;

export const isCatalogRow = (candidate: unknown): candidate is CatalogRow => typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
