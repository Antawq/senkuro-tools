import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const path = (relative: string) => resolve(dirname(fileURLToPath(import.meta.url)), '..', relative);

const html = readFileSync(path('entrypoints/popup/index.html'), 'utf8');

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const TAG_RESOURCES = /<(?:link|script|img|source|iframe|video|audio|embed)\b[^>]*?\b(?:href|src)=["']([^"']+)["']/gi;
const CSS_RESOURCES = /(?:url\(\s*|@import\s+)["']?([^"')\s]+)/gi;

const loaded = (): string[] => [...html.matchAll(TAG_RESOURCES), ...html.matchAll(CSS_RESOURCES)].map((match) => match[1] ?? '');

describe('popup assets', () => {
  it('loads nothing from the network on its own', () => {
    expect(loaded().filter((url) => REMOTE.test(url))).toEqual([]);
  });

  it('ships every font file it names', () => {
    const fonts = loaded().filter((url) => url.startsWith('/fonts/'));
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter((url) => !existsSync(path(`public${url}`)))).toEqual([]);
  });

  it('keeps the account buttons clear of the width and margin of the global button rule', () => {
    const rule = /\.account-button\s*\{([^}]*)\}/.exec(html)?.[1] ?? '';
    expect(rule).toMatch(/width:\s*auto/);
    expect(rule).toMatch(/margin-top:\s*0/);
  });

  it('ships the font licence next to the fonts', () => {
    expect(readFileSync(path('public/fonts/OFL.txt'), 'utf8')).toContain('SIL Open Font License');
  });
});
