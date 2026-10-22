import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { readAccessToken, readDocumentToken } from '../utils/token/access-token';

const cookie = (domain: string, value: string) => ({ name: 'access_token', value, domain });

let get: ReturnType<typeof vi.fn>;
let getAll: ReturnType<typeof vi.fn>;

beforeEach(() => {
  get = vi.fn().mockResolvedValue(null);
  getAll = vi.fn().mockResolvedValue([]);
  vi.spyOn(fakeBrowser.cookies, 'get').mockImplementation(get as never);
  vi.spyOn(fakeBrowser.cookies, 'getAll').mockImplementation(getAll as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readAccessToken', () => {
  it('takes the cookie of the page it was asked about', async () => {
    get.mockResolvedValue(cookie('.shiruho.me', 'v4.local.page'));
    expect(await readAccessToken('https://shiruho.me/cards/some-card?x=1')).toBe('v4.local.page');
    expect(get).toHaveBeenCalledWith({ url: 'https://shiruho.me', name: 'access_token' });
    expect(getAll).not.toHaveBeenCalled();
  });

  it('looks at senkuro.com when there is no page, as in the popup', async () => {
    await readAccessToken();
    expect(get).toHaveBeenCalledWith({ url: 'https://senkuro.com', name: 'access_token' });
  });

  it('does not take an extension page for a site', async () => {
    await readAccessToken('chrome-extension://abcdef/popup.html');
    await readAccessToken('not a url');
    expect(get.mock.calls.map(([query]) => (query as { url: string }).url)).toEqual(['https://senkuro.com', 'https://senkuro.com']);
  });

  it('falls back to the cookie of any supported domain', async () => {
    getAll.mockResolvedValue([cookie('example.com', 'other'), cookie('.senkognito.me', 'v4.local.mirror')]);
    expect(await readAccessToken()).toBe('v4.local.mirror');
    expect(getAll).toHaveBeenCalledWith({ name: 'access_token' });
  });

  it('does not take the cookie of a lookalike domain', async () => {
    getAll.mockResolvedValue([cookie('evilsenkuro.com', 'evil'), cookie('senkuro.com.evil.org', 'evil')]);
    expect(await readAccessToken()).toBeNull();
  });

  it('answers null when there is no cookie at all', async () => {
    expect(await readAccessToken('https://senkuro.me/')).toBeNull();
  });

  it('decodes a percent-encoded value and leaves a broken one alone', async () => {
    get.mockResolvedValueOnce(cookie('.senkuro.com', 'v4.local.a%2Db%5Fc'));
    expect(await readAccessToken()).toBe('v4.local.a-b_c');
    get.mockResolvedValueOnce(cookie('.senkuro.com', '100%'));
    expect(await readAccessToken()).toBe('100%');
  });
});

describe('readDocumentToken', () => {
  it('finds the cookie among the others and decodes it', () => {
    expect(readDocumentToken('theme=dark; access_token=v4.local.a%2Db; lang=ru')).toBe('v4.local.a-b');
    expect(readDocumentToken('access_token=v4.local.first')).toBe('v4.local.first');
  });

  it('does not take a cookie that only ends with the same name', () => {
    expect(readDocumentToken('old_access_token=nope; theme=dark')).toBeNull();
  });

  it('answers null without the cookie or with an empty one', () => {
    expect(readDocumentToken('theme=dark')).toBeNull();
    expect(readDocumentToken('access_token=')).toBeNull();
    expect(readDocumentToken('')).toBeNull();
  });

  it('leaves a broken value alone', () => {
    expect(readDocumentToken('access_token=100%')).toBe('100%');
  });

  it('reads the cookies of the page by default', () => {
    document.cookie = 'access_token=v4.local.page; path=/';
    expect(readDocumentToken()).toBe('v4.local.page');
    document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    expect(readDocumentToken()).toBeNull();
  });
});
