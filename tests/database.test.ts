import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      getURL: vi.fn(() => 'moz-extension://test/database.json'),
    },
  },
}));

describe('loadDatabase', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('retries after a failed fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ soran: { price: 1.25, name: 'Soran', rank: 'F' } }) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { loadDatabase } = await import('../utils/database');

    const first = await loadDatabase();
    const second = await loadDatabase();

    expect(first).toEqual({});
    expect(second).toEqual({ soran: { price: 1.25, name: 'Soran', rank: 'F' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
