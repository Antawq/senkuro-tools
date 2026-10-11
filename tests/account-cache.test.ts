import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { clearSnapshot, loadSnapshot, saveSnapshot } from '../utils/account-cache';
import { DEFAULT_SETTINGS, loadSettings, saveSetting } from '../utils/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('account snapshot', () => {
  const cards = [
    { slug: 'a-a', quantity: 2, shard: false },
    { slug: 'b-b', quantity: 1, shard: true },
  ];

  it('is empty until something is saved', async () => {
    expect(await loadSnapshot()).toBeNull();
  });

  it('keeps the cards and the time they were read', async () => {
    await saveSnapshot(cards, 1_700_000_000_000);
    expect(await loadSnapshot()).toEqual({ at: 1_700_000_000_000, cards });
  });

  it('stores every card as a short row', async () => {
    await saveSnapshot(cards, 5);
    expect((await fakeBrowser.storage.local.get('accountCards')).accountCards).toEqual({
      at: 5,
      cards: [
        ['a-a', 2, 0],
        ['b-b', 1, 1],
      ],
    });
  });

  it('replaces the previous snapshot', async () => {
    await saveSnapshot(cards, 1);
    await saveSnapshot([cards[0]!], 2);
    expect(await loadSnapshot()).toEqual({ at: 2, cards: [cards[0]] });
  });

  it('forgets everything on request', async () => {
    await saveSnapshot(cards, 1);
    await clearSnapshot();
    expect(await loadSnapshot()).toBeNull();
    expect(await fakeBrowser.storage.local.get('accountCards')).toEqual({});
  });

  it('survives damaged data by dropping what it cannot read', async () => {
    await fakeBrowser.storage.local.set({ accountCards: { at: 9, cards: [['ok', 3, 0], 'junk', ['bad', '1', 0], ['flag', 1, 5], null, ['piece', 2, 1]] } });
    expect(await loadSnapshot()).toEqual({
      at: 9,
      cards: [
        { slug: 'ok', quantity: 3, shard: false },
        { slug: 'piece', quantity: 2, shard: true },
      ],
    });
    await fakeBrowser.storage.local.set({ accountCards: 'garbage' });
    expect(await loadSnapshot()).toBeNull();
    await fakeBrowser.storage.local.set({ accountCards: { at: 'x', cards: [] } });
    expect(await loadSnapshot()).toBeNull();
  });

  it('does not touch the settings, and a settings reset does not touch it', async () => {
    await saveSnapshot(cards, 1);
    await saveSetting('fontSize', 20);
    expect((await loadSettings()).fontSize).toBe(20);
    expect(await loadSnapshot()).toEqual({ at: 1, cards });
    expect((await loadSettings()).opacity).toBe(DEFAULT_SETTINGS.opacity);
  });
});
