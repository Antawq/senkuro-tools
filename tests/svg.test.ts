import { describe, expect, it } from 'vitest';

import { chevronIcon, closeIcon, copyIcon, doneIcon, lockIcon, priceTagIcon, questionMarkIcon, refreshIcon, resetIcon, searchIcon } from '../utils/shared/svg';

describe('refreshIcon', () => {
  it('is a filled glyph in the 960 grid of the site icon set', () => {
    const icon = refreshIcon(20);
    expect(icon.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(icon.getAttribute('fill')).toBe('currentColor');
    expect(icon.getAttribute('stroke')).toBeNull();
    expect(icon.querySelectorAll('path')).toHaveLength(1);
  });

  it('takes the requested size', () => {
    const icon = refreshIcon(13);
    expect(icon.getAttribute('width')).toBe('13');
    expect(icon.getAttribute('height')).toBe('13');
  });
});

describe('copy, done and chevron icons', () => {
  it.each([
    ['copyIcon', () => copyIcon(18)],
    ['doneIcon', () => doneIcon(18)],
    ['chevronIcon', () => chevronIcon()],
    ['questionMarkIcon', () => questionMarkIcon(16)],
    ['priceTagIcon', () => priceTagIcon(20)],
    ['closeIcon', () => closeIcon(20)],
    ['resetIcon', () => resetIcon(20)],
    ['lockIcon', () => lockIcon(20)],
    ['searchIcon', () => searchIcon(20)],
  ])('%s is a filled glyph in the 960 grid with no stroke', (_name, create) => {
    const icon = create();
    expect(icon.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(icon.getAttribute('fill')).toBe('currentColor');
    expect(icon.getAttribute('stroke')).toBeNull();
    expect(icon.querySelectorAll('path')).toHaveLength(1);
  });

  it('takes the requested size for the copy and done icons', () => {
    for (const icon of [copyIcon(13), doneIcon(13)]) {
      expect(icon.getAttribute('width')).toBe('13');
      expect(icon.getAttribute('height')).toBe('13');
    }
  });

  it('gives the chevron its own class and a square box', () => {
    const icon = chevronIcon('senkuro-chip-arrow');
    expect(icon.getAttribute('class')).toBe('senkuro-chip-arrow');
    expect(icon.getAttribute('width')).toBe(icon.getAttribute('height'));
    expect(chevronIcon().hasAttribute('class')).toBe(false);
  });
});

describe('lock and search icons', () => {
  it.each([
    [
      'lockIcon',
      lockIcon,
      'M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-200q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z',
    ],
    [
      'searchIcon',
      searchIcon,
      'M380-320q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z',
    ],
  ])('%s is the published filled Material Symbols Rounded glyph at weight 400', (_name, create, path) => {
    expect(create(20).querySelector('path')?.getAttribute('d')).toBe(path);
  });
});
