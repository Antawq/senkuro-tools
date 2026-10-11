import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';

import { isTokenRequest, type TokenResponse } from '@/utils/messages';

const TOKEN_COOKIE = 'access_token';
const SENKURO_DOMAINS = ['senkuro.com', 'senkuro.me'];
const FALLBACK_ORIGIN = 'https://senkuro.com';

const originOf = (url: string | undefined): string => {
  try {
    return url ? new URL(url).origin : FALLBACK_ORIGIN;
  } catch {
    return FALLBACK_ORIGIN;
  }
};

async function readAccessToken(pageUrl: string | undefined): Promise<string | null> {
  const cookie = await browser.cookies.get({ url: originOf(pageUrl), name: TOKEN_COOKIE });
  if (cookie) return cookie.value;
  const cookies = await browser.cookies.getAll({ name: TOKEN_COOKIE });
  return cookies.find((candidate) => SENKURO_DOMAINS.some((domain) => candidate.domain.includes(domain)))?.value ?? null;
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse: (response: TokenResponse) => void) => {
    if (!isTokenRequest(message)) return false;
    readAccessToken(sender.url).then(
      (token) => sendResponse({ token }),
      () => sendResponse({ token: null })
    );
    return true;
  });
});
