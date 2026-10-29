export interface SourceResult {
  stale?: boolean;
  hasNext?: boolean;
}

export const isSettled = (sourceResult: SourceResult): boolean => !sourceResult.stale && !sourceResult.hasNext;
