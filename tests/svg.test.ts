import { describe, expect, it } from 'vitest';

import { chevronIcon, copyIcon, doneIcon, questionMarkIcon, refreshIcon } from '../utils/shared/svg';

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
