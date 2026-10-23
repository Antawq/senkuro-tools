import { describe, expect, it } from 'vitest';

import { widenSearchRequest } from '../utils/shared/search-page-size';
import type { QueryRequest } from '../utils/shared/urql-client';
import { firstOf, keyOf, request, searchDocument } from './helpers/search-requests';

const WIDER = 30;

describe('widenSearchRequest', () => {
  it('raises the page size of the search field only, on a copy of the document that leaves the original and the key as they are', () => {
    const original = request('search');
    const wider = widenSearchRequest(original, WIDER);
    expect(firstOf(wider)).toEqual([String(WIDER), '5']);
    expect(firstOf(original)).toEqual(['10', '5']);
    expect(wider.query).not.toBe(original.query);
    expect(wider.key).toBe(original.key);
    expect(wider.variables).toBe(original.variables);
    expect(keyOf(wider)).toBeUndefined();
    expect(keyOf(original)).toBe(123);
  });

  it('gives the same answer for the same request', () => {
    const one = request('search');
    expect(widenSearchRequest(one, WIDER)).toEqual(widenSearchRequest(one, WIDER));
  });

  it('widens a document once and reuses the copy, so the client does not print and hash a new one per search', () => {
    const one = request('search');
    expect(widenSearchRequest(one, WIDER).query).toBe(widenSearchRequest(one, WIDER).query);
  });

  it('uses the size it is given', () => {
    expect(firstOf(widenSearchRequest(request('search'), 40))).toEqual(['40', '5']);
  });

  it('leaves every other operation exactly as it is', () => {
    const other = request('fetchUserCards');
    expect(widenSearchRequest(other, WIDER)).toBe(other);
  });

  it('leaves a search that already asks for as much, or whose page size it cannot find', () => {
    const big = request('search', searchDocument('50'));
    expect(widenSearchRequest(big, WIDER)).toBe(big);
    const renamed = request('search', searchDocument('10', 'lookup'));
    expect(widenSearchRequest(renamed, WIDER)).toBe(renamed);
    const empty: QueryRequest = { key: 1 };
    expect(widenSearchRequest(empty, WIDER)).toBe(empty);
  });
});
