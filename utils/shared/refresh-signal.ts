import { isListScope, type ListScope } from './list-scope';
import { defineSignal } from './signal';

export const GUARD_ATTRIBUTE = 'data-senkutools-guard';
export const GUARD_READY = 'ready';

export type RefreshOutcome = 'done' | 'nothing' | 'failed';

export interface RefreshRequest {
  scope: ListScope;
}

export interface RefreshResult {
  scope: ListScope;
  outcome: RefreshOutcome;
}

const OUTCOMES: readonly unknown[] = ['done', 'nothing', 'failed'];

export const refreshRequestSignal = defineSignal<RefreshRequest>('senkutools:inventory-refresh', ({ scope }) => (isListScope(scope) ? { scope } : null));

export const refreshResultSignal = defineSignal<RefreshResult>('senkutools:inventory-refresh-result', ({ scope, outcome }) =>
  isListScope(scope) && OUTCOMES.includes(outcome) ? { scope, outcome: outcome as RefreshOutcome } : null
);

export const isGuardReady = (pageDocument: Document): boolean => pageDocument.documentElement.getAttribute(GUARD_ATTRIBUTE) === GUARD_READY;

export function requestInventoryRefresh(pageDocument: Document, scope: ListScope): Promise<RefreshOutcome> {
  return new Promise((resolve) => {
    const handleResult = (event: Event) => {
      const refreshResult = refreshResultSignal.read(event);
      if (refreshResult?.scope !== scope) return;
      pageDocument.removeEventListener(refreshResultSignal.name, handleResult);
      resolve(refreshResult.outcome);
    };
    pageDocument.addEventListener(refreshResultSignal.name, handleResult);
    pageDocument.dispatchEvent(new CustomEvent(refreshRequestSignal.name, { detail: refreshRequestSignal.encode({ scope }) }));
  });
}
