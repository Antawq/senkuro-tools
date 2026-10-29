import { describe, expect, it } from 'vitest';

import { widenSearchQuery } from '../utils/search/search-page-size';
import { firstOf, keyOf, searchDocument } from './helpers/search-requests';

const WIDER = 30;

describe('widenSearchQuery', () => {
  it('raises the page size of the search field only, on a copy of the document that leaves the original as it is and carries no key', () => {
    const original = searchDocument();
    const originalKey = keyOf(original);
    const wider = widenSearchQuery(original, WIDER);
    expect(firstOf(wider!)).toEqual([String(WIDER), '5']);
    expect(firstOf(original)).toEqual(['10', '5']);
    expect(wider).not.toBe(original);
    expect(keyOf(wider!)).toBeUndefined();
    expect(keyOf(original)).toBe(originalKey);
  });

  it('gives the same answer for the same document', () => {
    const one = searchDocument(12);
    expect(widenSearchQuery(one, WIDER)).toEqual(widenSearchQuery(one, WIDER));
  });

  it('widens a document once and reuses the copy, so the client does not print and hash a new one per search', () => {
    const one = searchDocument(13);
    expect(widenSearchQuery(one, WIDER)).toBe(widenSearchQuery(one, WIDER));
  });

  it('uses the size it is given', () => {
    expect(firstOf(widenSearchQuery(searchDocument(14), 40)!)).toEqual(['40', '5']);
  });

  it('leaves every other operation exactly as it is', () => {
    expect(widenSearchQuery(searchDocument(10, 'search', 'fetchUserCards'), WIDER)).toBeNull();
  });

  it('leaves a search that already asks for as much, or whose page size it cannot find', () => {
    expect(widenSearchQuery(searchDocument(50), WIDER)).toBeNull();
    expect(widenSearchQuery(searchDocument(10, 'lookup'), WIDER)).toBeNull();
  });
});
