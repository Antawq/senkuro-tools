import { describe, expect, it } from 'vitest';

import { isSettled } from '../utils/shared/urql-source';

describe('isSettled', () => {
  it('is false for a stale or streaming result only', () => {
    expect(isSettled({})).toBe(true);
    expect(isSettled({ stale: true })).toBe(false);
    expect(isSettled({ hasNext: true })).toBe(false);
  });
});
