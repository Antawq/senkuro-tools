import { isGraphqlRequest, requestUrl } from '../shared/graphql-request';
import { parseJson } from '../shared/json';
import type { PageWindow } from '../shared/page-window';
import type { Variables } from './list-families';
import { mentionsPrivateField } from './price-private';
import type { PageAnswer } from './price-view';

const JSON_TYPE = 'application/json';
const VARIABLES_PARAMETER = 'variables';

const bodyOf = (init: RequestInit | undefined): string => (typeof init?.body === 'string' ? init.body : '');

function readVariables(input: unknown, init: RequestInit | undefined, base: string): Variables {
  const fromBody = (parseJson(bodyOf(init)) as { variables?: unknown } | null)?.variables;
  const parsed = fromBody ?? parseJson(new URL(requestUrl(input), base).searchParams.get(VARIABLES_PARAMETER) ?? '');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Variables) : {};
}

export function answerPrivateRequests(pageWindow: PageWindow, view: { answer: (variables: Variables) => PageAnswer }): void {
  const previousFetch = pageWindow.fetch.bind(pageWindow);
  pageWindow.fetch = (...fetchArguments: Parameters<typeof fetch>) => {
    const [input, init] = fetchArguments;
    const base = pageWindow.location.href;
    if (!isGraphqlRequest(input, base)) return previousFetch(...fetchArguments);
    if (!mentionsPrivateField(`${requestUrl(input)}${bodyOf(init)}`)) return previousFetch(...fetchArguments);
    const body = JSON.stringify(view.answer(readVariables(input, init, base)));
    return Promise.resolve(new pageWindow.Response(body, { status: 200, headers: { 'content-type': JSON_TYPE } }));
  };
}
