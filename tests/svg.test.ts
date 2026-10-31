import { describe, expect, it } from 'vitest';

import { chevronIcon, closeIcon, lockIcon, lockOpenIcon, refreshIcon, searchIcon } from '../utils/shared/svg';

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

describe('lock icons', () => {
  it('lockIcon is a filled glyph in the 960 grid with closed shackle', () => {
    const icon = lockIcon(20);
    expect(icon.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(icon.getAttribute('fill')).toBe('currentColor');
    expect(icon.getAttribute('width')).toBe('20');
    expect(icon.getAttribute('height')).toBe('20');
    expect(icon.querySelector('path')?.getAttribute('d')).toContain('M240-80');
  });

  it('lockOpenIcon is a filled glyph in the 960 grid with open shackle', () => {
    const icon = lockOpenIcon(18);
    expect(icon.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(icon.getAttribute('fill')).toBe('currentColor');
    expect(icon.getAttribute('width')).toBe('18');
    expect(icon.getAttribute('height')).toBe('18');
    expect(icon.querySelector('path')?.getAttribute('d')).toContain('320-1000');
  });
});

describe('search and close icons', () => {
  it('searchIcon is a filled glyph in the 960 grid', () => {
    const icon = searchIcon(20);
    expect(icon.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(icon.getAttribute('fill')).toBe('currentColor');
    expect(icon.getAttribute('width')).toBe('20');
    expect(icon.getAttribute('height')).toBe('20');
    expect(icon.querySelector('path')?.getAttribute('d')).toContain('M784-120');
  });

  it('closeIcon is a filled glyph in the 960 grid', () => {
    const icon = closeIcon(16);
    expect(icon.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(icon.getAttribute('fill')).toBe('currentColor');
    expect(icon.getAttribute('width')).toBe('16');
    expect(icon.getAttribute('height')).toBe('16');
    expect(icon.querySelector('path')?.getAttribute('d')).toContain('M480-424');
  });
});
