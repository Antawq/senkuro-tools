import { parseJson } from './json';

export const REFRESH_REQUEST_EVENT = 'senkutools:inventory-refresh';
export const REFRESH_RESULT_EVENT = 'senkutools:inventory-refresh-result';
export const GUARD_ATTRIBUTE = 'data-senkutools-guard';
export const GUARD_READY = 'ready';

export type RefreshScope = 'grid' | 'picker';
export type RefreshOutcome = 'done' | 'nothing' | 'failed';

export interface RefreshResult {
  scope: RefreshScope;
  outcome: RefreshOutcome;
}

const SCOPES: readonly unknown[] = ['grid', 'picker'];
const OUTCOMES: readonly unknown[] = ['done', 'nothing', 'failed'];

function readDetail(event: Event): Record<string, unknown> | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'string') return null;
  const parsed = parseJson(detail);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
}

export const encodeRefreshRequest = (scope: RefreshScope): string => JSON.stringify({ scope });

export const encodeRefreshResult = ({ scope, outcome }: RefreshResult): string => JSON.stringify({ scope, outcome });

export function readRefreshRequest(event: Event): RefreshScope | null {
  const scope = readDetail(event)?.scope;
  return SCOPES.includes(scope) ? (scope as RefreshScope) : null;
}

export function readRefreshResult(event: Event): RefreshResult | null {
  const detail = readDetail(event);
  if (!detail || !SCOPES.includes(detail.scope) || !OUTCOMES.includes(detail.outcome)) return null;
  return { scope: detail.scope as RefreshScope, outcome: detail.outcome as RefreshOutcome };
}

export const isGuardReady = (pageDocument: Document): boolean => pageDocument.documentElement.getAttribute(GUARD_ATTRIBUTE) === GUARD_READY;

export function requestInventoryRefresh(pageDocument: Document, scope: RefreshScope): Promise<RefreshOutcome> {
  return new Promise((resolve) => {
    const handleResult = (event: Event) => {
      const result = readRefreshResult(event);
      if (result?.scope !== scope) return;
      pageDocument.removeEventListener(REFRESH_RESULT_EVENT, handleResult);
      resolve(result.outcome);
    };
    pageDocument.addEventListener(REFRESH_RESULT_EVENT, handleResult);
    pageDocument.dispatchEvent(new CustomEvent(REFRESH_REQUEST_EVENT, { detail: encodeRefreshRequest(scope) }));
  });
}
