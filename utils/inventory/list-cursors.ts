import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { LIST_OPERATION, familyIdOf, type Variables } from './list-families';

const CURSOR_KEY = 'after';
const MAX_CURSORS = 2000;

export interface CursorLedger {
  learn(variables: Variables, cursor: unknown): void;
  isForeign(variables: Variables): boolean;
}

const guardedClients = new WeakSet<QueryClient>();

const cursorOf = (variables: Variables): string | null => {
  const cursor = variables[CURSOR_KEY];
  return typeof cursor === 'string' ? cursor : null;
};

export function createCursorLedger(limit = MAX_CURSORS): CursorLedger {
  const listIdsByCursor = new Map<string, Set<string>>();
  return {
    learn(variables, cursor) {
      if (typeof cursor !== 'string' || cursor === '') return;
      const listIds = listIdsByCursor.get(cursor) ?? new Set<string>();
      listIds.add(familyIdOf(variables));
      listIdsByCursor.delete(cursor);
      listIdsByCursor.set(cursor, listIds);
      const oldestCursor = listIdsByCursor.keys().next();
      if (listIdsByCursor.size > limit && !oldestCursor.done) listIdsByCursor.delete(oldestCursor.value);
    },
    isForeign(variables) {
      const cursor = cursorOf(variables);
      const listIds = cursor === null ? undefined : listIdsByCursor.get(cursor);
      return listIds !== undefined && !listIds.has(familyIdOf(variables));
    },
  };
}

export function repairRequest(request: QueryRequest, ledger: CursorLedger): QueryRequest {
  const { variables } = request;
  if (operationName(request) !== LIST_OPERATION || !variables || !ledger.isForeign(variables)) return request;
  return { ...request, variables: { ...variables, [CURSOR_KEY]: null } };
}

const reportDroppedCursor = (onDrop: (variables: Variables) => void, variables: Variables): void => {
  try {
    onDrop(variables);
  } catch {
    return;
  }
};

export function guardCursors(client: QueryClient, onDrop: (variables: Variables) => void = () => undefined, ledger = createCursorLedger()): boolean {
  if (guardedClients.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      const repairedRequest = repairRequest(request, ledger);
      if (repairedRequest !== request && request.variables) reportDroppedCursor(onDrop, request.variables);
      return original(repairedRequest, options);
    };
  } catch {
    return false;
  }
  guardedClients.add(client);
  return true;
}
