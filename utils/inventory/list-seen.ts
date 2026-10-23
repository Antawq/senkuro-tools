import { isGraphqlRequest, isStreamed } from '../shared/graphql-request';
import { parseJson } from '../shared/json';
import type { PageWindow } from '../shared/page-window';
import type { CursorLedger } from './list-cursors';
import { LIST_OPERATION, type Variables } from './list-families';

interface ListQuery {
  operationName?: unknown;
  variables?: unknown;
}

interface ListAnswer {
  data?: { userCards?: { pageInfo?: { endCursor?: unknown } | null } | null } | null;
}

function listVariables(init: RequestInit | undefined): Variables | null {
  if (typeof init?.body !== 'string') return null;
  const query = parseJson(init.body) as ListQuery | null;
  const { variables } = query ?? {};
  return query?.operationName === LIST_OPERATION && variables && typeof variables === 'object' ? (variables as Variables) : null;
}

async function learnFromAnswer(response: Response, variables: Variables, ledger: CursorLedger): Promise<void> {
  if (isStreamed(response)) return;
  try {
    const answer = parseJson(await response.clone().text()) as ListAnswer | null;
    ledger.learn(variables, answer?.data?.userCards?.pageInfo?.endCursor);
  } catch {
    return;
  }
}

export function learnFromFetch(win: PageWindow, ledger: CursorLedger): void {
  const nativeFetch = win.fetch.bind(win);
  win.fetch = (...args: Parameters<typeof fetch>) => {
    const pending = nativeFetch(...args);
    const variables = isGraphqlRequest(args[0], win.location.href) ? listVariables(args[1]) : null;
    if (!variables) return pending;
    ledger.learn(variables, variables.after);
    return pending.then(async (response) => {
      await learnFromAnswer(response, variables, ledger);
      return response;
    });
  };
}
