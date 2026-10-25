import { describe, expect, it } from 'vitest';

import { SORT_TEXT, isOwnLabel, loadingLabelOf } from '../utils/sort/sort-dom';

describe('isOwnLabel', () => {
  it('knows every label the view writes on the sort button, whatever their text is', () => {
    for (const percent of [null, 0, 7, 100]) expect(isOwnLabel(loadingLabelOf(percent))).toBe(true);
    expect(isOwnLabel(SORT_TEXT.partialLabel)).toBe(true);
  });

  it('does not take a label of the site, or a progress label that is not one, for its own', () => {
    for (const text of [
      'По дате получения',
      '',
      null,
      undefined,
      `${SORT_TEXT.label} %`,
      `${SORT_TEXT.label}  5%`,
      `${SORT_TEXT.label} 5`,
      `${SORT_TEXT.label} 5% `,
    ]) {
      expect(isOwnLabel(text)).toBe(false);
    }
  });
});
