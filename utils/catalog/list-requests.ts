import { getOperationName, mapExchange, type Exchange } from '@urql/core';

export const CATALOG_LIST_OPERATIONS: ReadonlySet<string> = new Set(['fetchMangas', 'fetchAnimes', 'fetchCards', 'fetchCardDecks']);

export function listRequestExchange(noteListRequest: () => void): Exchange {
  const lastKeyByName = new Map<string, number>();
  return mapExchange({
    onOperation(operation) {
      if (operation.kind !== 'query') return;
      const name = getOperationName(operation.query);
      if (!name || !CATALOG_LIST_OPERATIONS.has(name)) return;
      const lastKey = lastKeyByName.get(name);
      lastKeyByName.set(name, operation.key);
      if (lastKey !== undefined && lastKey !== operation.key) noteListRequest();
    },
  });
}
