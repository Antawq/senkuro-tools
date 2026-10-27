import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const path = (relative: string) => resolve(dirname(fileURLToPath(import.meta.url)), '..', relative);

const markup = readFileSync(path('entrypoints/popup/index.html'), 'utf8');
const styles = readFileSync(path('entrypoints/popup/style.css'), 'utf8');
const html = [markup, styles].join('\n');

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

  it('ships the font licence next to the fonts', () => {
    expect(readFileSync(path('public/fonts/OFL.txt'), 'utf8')).toContain('SIL Open Font License');
  });
});

describe('popup controls', () => {
  const page = new DOMParser().parseFromString(markup, 'text/html');

  it('names every select, slider and switch with a label a screen reader reads', () => {
    const unnamed = [...page.querySelectorAll<HTMLElement>('select, input')].filter(
      (control) => !control.closest('label') && !page.querySelector(`label[for="${control.id}"]`)
    );
    expect(unnamed.map((control) => control.id)).toEqual([]);
  });

  it('shows a focus ring on every control whose outline it removes', () => {
    const stripped = [...styles.matchAll(/([^{}]+)\{[^}]*outline:\s*none/g)].map((match) => (match[1] ?? '').trim());
    const focused = [...styles.matchAll(/([^{}]+:focus(?:-visible)?)\s*\{[^}]*(?:outline|border-color|box-shadow)/g)].map((match) => match[1] ?? '');
    const kinds = ['checkbox', 'range', 'summary', 'select'];
    const unringed = stripped.filter((selector) => {
      const kind = kinds.find((name) => selector.includes(name));
      return !kind || !focused.some((rule) => rule.includes(kind));
    });
    expect(stripped).toHaveLength(4);
    expect(unringed).toEqual([]);
  });

  it('keeps the logo next to the name out of what a screen reader says', () => {
    expect(page.querySelector('img.logo')?.getAttribute('alt')).toBe('');
  });
});
