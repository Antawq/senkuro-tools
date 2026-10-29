import { describe, expect, it } from 'vitest';

import { isGraphqlRequest, isStreamed } from '../utils/shared/graphql-request';

const BASE = 'https://senkuro.me/users/sena/cards';

describe('isGraphqlRequest', () => {
  it('knows the graphql address whether it comes as text, a URL or a request object', () => {
    expect(isGraphqlRequest('https://api.senkuro.me/graphql', BASE)).toBe(true);
    expect(isGraphqlRequest(new URL('https://api.senkuro.me/graphql'), BASE)).toBe(true);
    expect(isGraphqlRequest({ url: 'https://api.senkuro.me/graphql' }, BASE)).toBe(true);
    expect(isGraphqlRequest('/graphql', BASE)).toBe(true);
  });

  it('says no for another address, a request object without one, and an address it cannot read', () => {
    expect(isGraphqlRequest('https://api.senkuro.me/graphql/extra', BASE)).toBe(false);
    expect(isGraphqlRequest({}, BASE)).toBe(false);
    expect(isGraphqlRequest(null, BASE)).toBe(false);
    expect(isGraphqlRequest('http://[bad', BASE)).toBe(false);
  });
});

describe('isStreamed', () => {
  it('tells a multipart or event stream answer from a plain one', () => {
    expect(isStreamed(new Response('', { headers: { 'content-type': 'multipart/mixed' } }))).toBe(true);
    expect(isStreamed(new Response('', { headers: { 'content-type': 'text/event-stream' } }))).toBe(true);
    expect(isStreamed(new Response('', { headers: { 'content-type': 'application/json' } }))).toBe(false);
  });
});
