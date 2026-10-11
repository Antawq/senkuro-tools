import { describe, expect, it } from 'vitest';

import { SENKURO_DOMAINS, SENKURO_MATCHES, isSenkuroDomain } from '../utils/hosts';

describe('hosts', () => {
  it('builds one match pattern per supported domain', () => {
    expect(SENKURO_MATCHES).toEqual(SENKURO_DOMAINS.map((domain) => `*://*.${domain}/*`));
    expect(SENKURO_MATCHES).toContain('*://*.shiruho.me/*');
    expect(SENKURO_MATCHES).toContain('*://*.senkognito.com/*');
  });

  it.each(SENKURO_DOMAINS)('recognises cookies of %s and its subdomains', (domain) => {
    expect(isSenkuroDomain(domain)).toBe(true);
    expect(isSenkuroDomain(`.${domain}`)).toBe(true);
    expect(isSenkuroDomain(`api.${domain}`)).toBe(true);
    expect(isSenkuroDomain(`.API.${domain.toUpperCase()}`)).toBe(true);
  });

  it.each(['', 'example.com', 'evilsenkuro.com', 'senkuro.com.evil.org', 'senkuro.org', 'notshiruho.me'])('rejects the cookie domain %j', (domain) => {
    expect(isSenkuroDomain(domain)).toBe(false);
  });
});
