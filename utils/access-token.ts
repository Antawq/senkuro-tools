import { browser } from 'wxt/browser';

import { isSenkuroDomain } from './hosts';

const TOKEN_COOKIE = 'access_token';
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
