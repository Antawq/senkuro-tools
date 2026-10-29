import { makeOperation, type Exchange, type Operation, type OperationResult } from '@urql/core';
import { map, pipe, tap } from 'wonka';

import { CURSOR_KEY, familyIdOf, listVariablesOf, type Variables } from './list-families';

const MAX_CURSORS = 2000;

export interface CursorLedger {
  learn(variables: Variables, cursor: unknown): void;
  isForeign(variables: Variables): boolean;
}

interface ListAnswer {
  userCards?: { pageInfo?: { endCursor?: unknown } | null } | null;
}

const cursorOf = (variables: Variables): string | null => {
  const cursor = variables[CURSOR_KEY];
  return typeof cursor === 'string' ? cursor : null;
};

export function createCursorLedger(maxCursors = MAX_CURSORS): CursorLedger {
  const listIdsByCursor = new Map<string, Set<string>>();
  return {
    learn(variables, cursor) {
      if (typeof cursor !== 'string' || cursor === '') return;
      const listIds = listIdsByCursor.get(cursor) ?? new Set<string>();
      listIds.add(familyIdOf(variables));
      listIdsByCursor.delete(cursor);
      listIdsByCursor.set(cursor, listIds);
      const oldestCursor = listIdsByCursor.keys().next();
      if (listIdsByCursor.size > maxCursors && !oldestCursor.done) listIdsByCursor.delete(oldestCursor.value);
    },
    isForeign(variables) {
      const cursor = cursorOf(variables);
      const listIds = cursor === null ? undefined : listIdsByCursor.get(cursor);
      return listIds !== undefined && !listIds.has(familyIdOf(variables));
    },
  };
}

export function repairOperation(operation: Operation, ledger: CursorLedger): Operation {
  const variables = listVariablesOf(operation);
  if (!variables || !ledger.isForeign(variables)) return operation;
  return makeOperation(operation.kind, { ...operation, variables: { ...variables, [CURSOR_KEY]: null } }, operation.context);
}

const reportDroppedCursor = (onDrop: (variables: Variables) => void, variables: Variables): void => {
  try {
    onDrop(variables);
  } catch {
    return;
  }
};

function learnFromResult(result: OperationResult, ledger: CursorLedger): void {
  const variables = listVariablesOf(result.operation);
  if (variables) ledger.learn(variables, (result.data as ListAnswer | null | undefined)?.userCards?.pageInfo?.endCursor);
}

export function cursorExchange(ledger: CursorLedger, onDrop: (variables: Variables) => void = () => undefined): Exchange {
  const guard = (operation: Operation): Operation => {
    const repaired = repairOperation(operation, ledger);
    const variables = listVariablesOf(repaired);
    if (repaired !== operation) reportDroppedCursor(onDrop, operation.variables as Variables);
    if (variables) ledger.learn(variables, variables[CURSOR_KEY]);
    return repaired;
  };
  return ({ forward }) =>
    (operations$) =>
      pipe(
        forward(pipe(operations$, map(guard))),
        tap((result) => learnFromResult(result, ledger))
      );
}
