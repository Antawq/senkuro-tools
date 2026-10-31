import { describe, expect, it } from 'vitest';

import { createRange, formatBound, isInRange, isReversed, parseBound, rangeKeyOf, readRange, writeRange } from '../utils/sort/price-range';

describe('parseBound', () => {
  it('reads a number typed with a comma or a point, with spaces between the digits', () => {
    expect(parseBound('1,5')).toBe(1.5);
    expect(parseBound('1.5')).toBe(1.5);
    expect(parseBound(' 12 ')).toBe(12);
    expect(parseBound('1 000,25')).toBe(1000.25);
    expect(parseBound(`2${String.fromCharCode(0xa0)}500`)).toBe(2500);
    expect(parseBound('0')).toBe(0);
  });

  it('gives no bound for an empty field or text that is not a number', () => {
    for (const text of ['', '   ', 'abc', '1,2,3', '1.2.3', '12р', '-', ',']) expect(parseBound(text), text).toBeNull();
  });
});

describe('createRange', () => {
  it('is no range when neither bound is set, and an open range when one is', () => {
    expect(createRange(null, null)).toBeNull();
    expect(createRange(10, null)).toEqual({ min: 10, max: null });
    expect(createRange(null, 50)).toEqual({ min: null, max: 50 });
  });

  it('keeps bounds typed the wrong way round as they are, and tells them apart', () => {
    expect(createRange(50, 10)).toEqual({ min: 50, max: 10 });
    expect(isReversed({ min: 50, max: 10 })).toBe(true);
    expect(isReversed({ min: 7, max: 7 })).toBe(false);
    expect(isReversed({ min: 7, max: null })).toBe(false);
    expect(isReversed({ min: null, max: 7 })).toBe(false);
  });
});

describe('isInRange', () => {
  it('takes both bounds in', () => {
    const range = { min: 10, max: 20 };
    expect(isInRange(10, range)).toBe(true);
    expect(isInRange(20, range)).toBe(true);
    expect(isInRange(15.5, range)).toBe(true);
    expect(isInRange(9.99, range)).toBe(false);
    expect(isInRange(20.01, range)).toBe(false);
  });

  it('has no end on the side with no bound', () => {
    expect(isInRange(1e6, { min: 10, max: null })).toBe(true);
    expect(isInRange(0, { min: null, max: 10 })).toBe(true);
    expect(isInRange(9, { min: 10, max: null })).toBe(false);
  });

  it('leaves out a card with no price, whatever the range', () => {
    expect(isInRange(null, { min: null, max: 10 })).toBe(false);
    expect(isInRange(null, { min: 0, max: null })).toBe(false);
  });
});

describe('the range on a toolbar', () => {
  it('is written once and read back as the same range', () => {
    const toolbar = document.createElement('div');
    for (const range of [
      { min: 1.5, max: 20 },
      { min: null, max: 20 },
      { min: 0, max: null },
    ]) {
      writeRange(toolbar, range);
      expect(readRange(toolbar)).toEqual(range);
    }
    expect(toolbar.getAttribute('data-senkutools-price-range')).toBe('0:');
  });

  it('is taken off by no range, and read as no range when it is missing or not one', () => {
    const toolbar = document.createElement('div');
    writeRange(toolbar, { min: 1, max: 2 });
    writeRange(toolbar, null);
    expect(toolbar.hasAttribute('data-senkutools-price-range')).toBe(false);
    expect(readRange(toolbar)).toBeNull();
    for (const text of ['', ':', 'a:b', '1:2:3', '5', '50:10']) {
      toolbar.setAttribute('data-senkutools-price-range', text);
      expect(readRange(toolbar), text).toBeNull();
    }
  });

  it('has a key that tells ranges apart and is null for no range', () => {
    expect(rangeKeyOf(null)).toBeNull();
    expect(rangeKeyOf({ min: 1, max: null })).not.toBe(rangeKeyOf({ min: null, max: 1 }));
    expect(formatBound(null)).toBe('');
    expect(formatBound(2.5)).toBe('2.5');
  });
});
