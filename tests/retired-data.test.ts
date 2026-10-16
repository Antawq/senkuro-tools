import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { forgetRetiredData } from '../utils/retired-data';
import { loadSettings, saveSetting } from '../utils/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('forgetRetiredData', () => {
  it('drops the card list the removed account panel kept', async () => {
    await fakeBrowser.storage.local.set({ accountCards: { at: 1, cards: [['a-a', 2, 0]] } });
    await forgetRetiredData();
    expect(await fakeBrowser.storage.local.get('accountCards')).toEqual({});
  });

  it('drops the switch for automatic counting the menu no longer has', async () => {
    await fakeBrowser.storage.local.set({ autoProfileValue: true });
    await forgetRetiredData();
    expect(await fakeBrowser.storage.local.get('autoProfileValue')).toEqual({});
  });

  it('leaves the settings alone', async () => {
    await saveSetting('fontSize', 20);
    await forgetRetiredData();
    expect((await loadSettings()).fontSize).toBe(20);
  });
});
