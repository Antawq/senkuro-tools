export const SENKURO_DOMAINS = ['senkuro.com', 'senkuro.me', 'shiruho.com', 'shiruho.me', 'senkognito.com', 'senkognito.me'];

export const SENKURO_MATCHES = SENKURO_DOMAINS.map((domain) => `*://*.${domain}/*`);

export function isSenkuroDomain(cookieDomain: string): boolean {
  const host = cookieDomain.replace(/^\./, '').toLowerCase();
  return SENKURO_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
