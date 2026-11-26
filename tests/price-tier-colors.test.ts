import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../utils/shared/settings';
import { blendOver, contrastRatio, oklabDistance, rgbOfHex, type Rgb } from './color-math';

const assets = (name: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets', name), 'utf8');

const TIER_NAMES = ['white', 'green', 'purple', 'yellow', 'red'] as const;
const MIN_TEXT_CONTRAST = 4.5;
const MIN_TIER_DISTANCE = 0.1;
const WHITE_ART: Rgb = [255, 255, 255];

const tokens = assets('tokens.css');

const tokenValue = (name: string): string => {
  const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
  if (!declaration) throw new Error(`no ${name} in tokens.css`);
  return (declaration[1] ?? '').trim();
};

const colorOf = (name: string): Rgb => {
  const value = tokenValue(name);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? colorOf(reference[1] ?? '') : rgbOfHex(value);
};

const tierColor = (tier: (typeof TIER_NAMES)[number]): Rgb => colorOf(`--senkuro-tier-${tier}`);

const fillOverWhiteArt = (shade: number): Rgb => blendOver(colorOf('--senkuro-ink'), shade / 100, WHITE_ART);

describe('the price tier palette', () => {
  it.each(TIER_NAMES)('keeps the %s tier readable on the lightest tag fill, which is ink at the default shade over white art', (tier) => {
    expect(contrastRatio(tierColor(tier), fillOverWhiteArt(DEFAULT_SETTINGS.opacity))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('keeps the rainbow effect blue as readable as the tiers', () => {
    expect(contrastRatio(colorOf('--senkuro-rainbow-blue'), fillOverWhiteArt(DEFAULT_SETTINGS.opacity))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('starts the ladder at the ink of the site tag, so the cheapest tag stays the site tag', () => {
    expect(tokenValue('--senkuro-tier-white')).toBe('var(--senkuro-badge-text)');
    expect(colorOf('--senkuro-tier-white')).toEqual(rgbOfHex('#f1f1f1'));
  });

  it('keeps every pair of tiers apart in OKLab, so no two read as one at 12px', () => {
    const pairs = TIER_NAMES.flatMap((first, index) => TIER_NAMES.slice(index + 1).map((second) => [first, second] as const));
    expect(pairs).toHaveLength(10);
    for (const [first, second] of pairs)
      expect(oklabDistance(tierColor(first), tierColor(second)), `${first} against ${second}`).toBeGreaterThanOrEqual(MIN_TIER_DISTANCE);
  });

  it('is the only palette: the popup chips read the shared tier tokens', () => {
    const popup = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../entrypoints/popup/style.css'), 'utf8');
    for (const tier of TIER_NAMES.filter((name) => name !== 'white')) expect(popup).toContain(`--c-tier-${tier}: var(--senkuro-tier-${tier});`);
  });
});
