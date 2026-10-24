import { describe, expect, it } from 'vitest';

import { refreshIcon } from '../utils/shared/svg';

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
