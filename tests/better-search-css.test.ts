import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/better-search.css'), 'utf8').replaceAll(
  String.fromCharCode(13),
  ''
);

const SITE_TOKENS = new Set([
  '--accent-pressed',
  '--accent-quaternary',
  '--accent-secondary',
  '--accent-tertiary',
  '--bg-primary',
  '--bg-quaternary',
  '--text-primary',
  '--text-secondary',
  '--transition',
]);

const modal = (attributes = '') => `
  <div class="modal-content--search" ${attributes}>
    <div class="nav-search__cnt">
      <a class="card-search" href="/manga/a" data-index="0"><div class="cover-wrapper"></div><div class="card-body">A</div></a>
      <a class="card-search card-search--active" href="/manga/b" data-index="1"><div class="cover-wrapper"></div><div class="card-body">B</div></a>
      <div class="nav-search__cnt-empty">Ничего не найдено</div>
    </div>
  </div>`;

const styleOf = (selector: string) => getComputedStyle(document.querySelector(selector) as Element);

beforeEach(() => {
  document.head.innerHTML = `<style>${stylesheet}</style>`;
});

describe('better-search stylesheet values', () => {
  it('takes every colour from the site tokens and invents none', () => {
    expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(stylesheet).not.toMatch(/\brgba?\(|\bhsla?\(|\boklch\(/i);
    const declared = new Set([...stylesheet.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1] ?? ''));
    const used = [...stylesheet.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1] ?? '');
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !SITE_TOKENS.has(name) && !declared.has(name))).toEqual([]);
  });

  it('adds no hover outside a hover-capable pointer and no raw durations', () => {
    const outsideHoverMedia = stylesheet.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}\n/g, '');
    expect(outsideHoverMedia).not.toContain(':hover');
    expect(stylesheet).not.toMatch(/\d+m?s\b/);
    expect(stylesheet).not.toContain('!important');
  });

  it('ends the list above the phone dock and cuts it through a row, not at a sliver of one', () => {
    expect(stylesheet).toMatch(/^\.modal-content--search \{\s+--better-search-chrome: 246px;/m);
    expect(stylesheet).toMatch(/\(width >= 576px\) \{\s+\.modal-content--search \{\s+--better-search-chrome: 260px;/);
  });

  it('cuts the list through the middle of a row, and only where round() exists, so other browsers keep the plain height', () => {
    expect(stylesheet).toContain('@supports (max-height: round(down, 10px, 1px)) {');
    expect(stylesheet).toContain('--better-search-row: 88px;');
    expect(stylesheet).toContain('calc(16px + 7.5 * var(--better-search-row))');
    expect(stylesheet).toContain('calc(100dvh - var(--better-search-chrome))');
    const [plain, snapped] = stylesheet.match(/max-height: [^;]+;/g) ?? [];
    expect(plain).toBe('max-height: var(--better-search-room);');
    expect(snapped).toContain('round(down, var(--better-search-room) - var(--better-search-tail), var(--better-search-row))');
  });

  it('keeps the whole height of the list on a phone held sideways, where a snapped height would cost a row', () => {
    const sideways = stylesheet.slice(stylesheet.indexOf('@media (max-height: 480px)'));
    expect(sideways).toContain('max-height: var(--better-search-room);');
  });

  it('trades the site top margin for list height on a phone held sideways', () => {
    const sideways = stylesheet.slice(stylesheet.indexOf('@media (max-height: 480px)'));
    expect(sideways).toContain('.modal-content.modal-content--search');
    expect(sideways).toContain('margin-top: 8px');
    expect(sideways).toContain('--better-search-chrome: 190px');
  });

  it('sizes the popular query chips through the button size variable, not by overriding the height', () => {
    expect(stylesheet).toContain('.button-size--sm');
    expect(stylesheet).toContain('--button-size: 36px');
    expect(stylesheet).not.toContain('min-height');
  });

  it('keeps the tab arrows tinted like the form they sit in', () => {
    expect(stylesheet).toContain('linear-gradient(var(--bg-quaternary), var(--bg-quaternary)), var(--bg-primary)');
  });
});

describe('better-search page states', () => {
  it('dims the covers while a search is in flight but never the text, which would drop under 4.5:1', () => {
    document.body.innerHTML = modal('data-searching');
    expect(styleOf('.cover-wrapper').opacity).toBe('0.6');
    expect(styleOf('.card-body').opacity).not.toBe('0.6');
    expect(styleOf('.nav-search__cnt').opacity).not.toBe('0.6');
  });

  it('leaves the covers alone when nothing is in flight', () => {
    document.body.innerHTML = modal();
    expect(styleOf('.cover-wrapper').opacity).not.toBe('0.6');
  });

  it('hides the rows of a query that is too short to search', () => {
    document.body.innerHTML = modal('data-stale');
    expect(styleOf('.card-search').display).toBe('none');
  });

  it('shows the rows otherwise', () => {
    document.body.innerHTML = modal();
    expect(styleOf('.card-search').display).not.toBe('none');
  });
});
