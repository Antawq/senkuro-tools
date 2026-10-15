import { browser } from 'wxt/browser';

import { SITE_ORIGIN, isSenkuroDomain } from './hosts';
import { decodeSafely } from './uri';

const TOKEN_COOKIE = 'access_token';
const IN_DOCUMENT = new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`);

const originOf = (url: string | undefined): string => {
  try {
    const parsed = url ? new URL(url) : null;
    return parsed && /^https?:$/.test(parsed.protocol) ? parsed.origin : SITE_ORIGIN;
  } catch {
    return SITE_ORIGIN;
  }
};

export async function readAccessToken(pageUrl?: string): Promise<string | null> {
  const cookie = await browser.cookies.get({ url: originOf(pageUrl), name: TOKEN_COOKIE });
  if (cookie) return decodeSafely(cookie.value);
  const cookies = await browser.cookies.getAll({ name: TOKEN_COOKIE });
  const found = cookies.find((candidate) => isSenkuroDomain(candidate.domain));
  return found ? decodeSafely(found.value) : null;
}

export function readDocumentToken(cookies: string = document.cookie): string | null {
  const value = IN_DOCUMENT.exec(cookies)?.[1];
  return value ? decodeSafely(value) : null;
}
