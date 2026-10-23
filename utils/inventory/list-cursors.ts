import { operationName, type QueryClient, type QueryRequest } from '../shared/urql-client';
import { LIST_OPERATION, familyIdOf, type Variables } from './list-families';

const CURSOR_KEY = 'after';
const MAX_CURSORS = 2000;

export interface CursorLedger {
  learn(variables: Variables, cursor: unknown): void;
  isForeign(variables: Variables): boolean;
}

const guarded = new WeakSet<QueryClient>();

const cursorOf = (variables: Variables): string | null => {
  const cursor = variables[CURSOR_KEY];
  return typeof cursor === 'string' ? cursor : null;
};

export function createCursorLedger(limit = MAX_CURSORS): CursorLedger {
  const issuedBy = new Map<string, Set<string>>();
  return {
    learn(variables, cursor) {
      if (typeof cursor !== 'string' || cursor === '') return;
      const lists = issuedBy.get(cursor) ?? new Set<string>();
      lists.add(familyIdOf(variables));
      issuedBy.delete(cursor);
      issuedBy.set(cursor, lists);
      const oldest = issuedBy.keys().next();
      if (issuedBy.size > limit && !oldest.done) issuedBy.delete(oldest.value);
    },
    isForeign(variables) {
      const cursor = cursorOf(variables);
      const lists = cursor === null ? undefined : issuedBy.get(cursor);
      return lists !== undefined && !lists.has(familyIdOf(variables));
    },
  };
}

export function repairRequest(request: QueryRequest, ledger: CursorLedger): QueryRequest {
  const { variables } = request;
  if (operationName(request) !== LIST_OPERATION || !variables || !ledger.isForeign(variables)) return request;
  return { ...request, variables: { ...variables, [CURSOR_KEY]: null } };
}

const report = (onDrop: (variables: Variables) => void, variables: Variables): void => {
  try {
    onDrop(variables);
  } catch {
    return;
  }
};

export function guardCursors(client: QueryClient, onDrop: (variables: Variables) => void = () => undefined, ledger = createCursorLedger()): boolean {
  if (guarded.has(client)) return true;
  const original = client.executeQuery.bind(client);
  try {
    client.executeQuery = (request, options) => {
      const fixed = repairRequest(request, ledger);
      if (fixed !== request && request.variables) report(onDrop, request.variables);
      return original(fixed, options);
    };
  } catch {
    return false;
  }
  guarded.add(client);
  return true;
}
