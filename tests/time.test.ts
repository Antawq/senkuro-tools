import { describe, expect, it } from 'vitest';

import { formatTradeTime, parseApiTime } from '../utils/time';

describe('parseApiTime', () => {
  it('reads the naive UTC time of the API down to the millisecond', () => {
    expect(parseApiTime('2026-10-17T18:31:05.923657')?.toISOString()).toBe('2026-10-17T18:31:05.923Z');
    expect(parseApiTime('2026-10-17T18:31:05')?.toISOString()).toBe('2026-10-17T18:31:05.000Z');
  });

  it('keeps a zone the value names', () => {
    expect(parseApiTime('2026-10-17T18:31:05Z')?.toISOString()).toBe('2026-10-17T18:31:05.000Z');
    expect(parseApiTime('2026-10-17T23:31:05+05:00')?.toISOString()).toBe('2026-10-17T18:31:05.000Z');
  });

  it('gives nothing for a missing or broken value', () => {
    expect(parseApiTime(null)).toBeNull();
    expect(parseApiTime('вчера')).toBeNull();
    expect(parseApiTime('2026-13-45T99:99:99')).toBeNull();
  });
});

describe('formatTradeTime', () => {
  it('shows the local date and the time to the minute', () => {
    expect(formatTradeTime(new Date(2026, 9, 17, 23, 31, 5))).toBe('17.10.26, 23:31');
    expect(formatTradeTime(new Date(2026, 9, 18, 0, 5))).toBe('18.10.26, 00:05');
  });
});
