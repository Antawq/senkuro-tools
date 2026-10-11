import { browser } from 'wxt/browser';

import { SENKURO_MATCHES, isSenkuroDomain } from './hosts';
import { TOKEN_REQUEST, isTokenRequest, type TokenRequest, type TokenResponse } from './messages';

const TOKEN_COOKIE = 'access_token';
const IN_DOCUMENT = new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`);
const FALLBACK_ORIGIN = 'https://senkuro.com';

const originOf = (url: string | undefined): string => {
  try {
    const parsed = url ? new URL(url) : null;
    return parsed && /^https?:$/.test(parsed.protocol) ? parsed.origin : FALLBACK_ORIGIN;
  } catch {
    return FALLBACK_ORIGIN;
  }
};

const decoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export async function readAccessToken(pageUrl?: string): Promise<string | null> {
  const cookie = await browser.cookies.get({ url: originOf(pageUrl), name: TOKEN_COOKIE });
  if (cookie) return decoded(cookie.value);
  const cookies = await browser.cookies.getAll({ name: TOKEN_COOKIE });
  const found = cookies.find((candidate) => isSenkuroDomain(candidate.domain));
  return found ? decoded(found.value) : null;
}

export function readDocumentToken(cookies: string = document.cookie): string | null {
  const value = IN_DOCUMENT.exec(cookies)?.[1];
  return value ? decoded(value) : null;
}

export function answerTokenRequests(): () => void {
  const listener = (message: unknown, _sender: unknown, sendResponse: (response: TokenResponse) => void) => {
    if (!isTokenRequest(message)) return false;
    sendResponse({ token: readDocumentToken() });
    return false;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

export async function readTokenFromSite(): Promise<string | null> {
  const tabs = await browser.tabs.query({ url: SENKURO_MATCHES, currentWindow: true }).catch(() => []);
  const tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
  if (tab?.id !== undefined) {
    const request: TokenRequest = { type: TOKEN_REQUEST };
    const answer = await browser.tabs.sendMessage<TokenRequest, TokenResponse | undefined>(tab.id, request).catch(() => undefined);
    if (answer?.token) return answer.token;
  }
  return readAccessToken(tab?.url);
}
