export const PRIMARY_DOMAIN = 'senkuro.com';

export const SENKURO_DOMAINS = [PRIMARY_DOMAIN, 'senkuro.me', 'shiruho.com', 'shiruho.me', 'senkognito.com', 'senkognito.me'];

export const SITE_ORIGIN = `https://${PRIMARY_DOMAIN}`;

export const SENKURO_MATCHES = SENKURO_DOMAINS.map((domain) => `*://*.${domain}/*`);

export function isSenkuroDomain(cookieDomain: string): boolean {
  const host = cookieDomain.replace(/^\./, '').toLowerCase();
  return SENKURO_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
