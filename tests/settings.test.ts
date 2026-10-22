import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DEFAULT_SETTINGS, loadSettings, resetSettings, saveSetting, watchSettings, type Settings } from '../utils/shared/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings', () => {
  it('falls back to the defaults the popup shows', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps values saved by earlier versions under the same keys', async () => {
    await fakeBrowser.storage.local.set({ copyBtn: true });
    const settings = await loadSettings();
    expect(settings.copyBtn).toBe(true);
    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it.each([
    ['top-left', 'left', 'top'],
    ['center-left', 'left', 'center'],
    ['bottom-left', 'left', 'bottom'],
    ['top-right', 'right', 'top'],
    ['center-right', 'right', 'center'],
    ['bottom-right', 'right', 'bottom'],
    ['center', 'center', 'center'],
  ])('carries the badge position %s over to the two axes', async (legacy, x, y) => {
    await fakeBrowser.storage.local.set({ position: legacy });
    const settings = await loadSettings();
    expect([settings.positionX, settings.positionY]).toEqual([x, y]);
    expect(await fakeBrowser.storage.local.get('position')).toEqual({});
  });

  it('lets an axis chosen after the update win over the old badge position', async () => {
    await fakeBrowser.storage.local.set({ position: 'top-left', positionX: 'center' });
    const settings = await loadSettings();
    expect([settings.positionX, settings.positionY]).toEqual(['center', 'top']);
  });

  it('drops an unknown old badge position and keeps the defaults', async () => {
    await fakeBrowser.storage.local.set({ position: 'somewhere' });
    const settings = await loadSettings();
    expect([settings.positionX, settings.positionY]).toEqual([DEFAULT_SETTINGS.positionX, DEFAULT_SETTINGS.positionY]);
    expect(await fakeBrowser.storage.local.get('position')).toEqual({});
  });

  it('migrates the old badge position once', async () => {
    await fakeBrowser.storage.local.set({ position: 'top-left' });
    await loadSettings();
    await saveSetting('positionX', 'right');
    expect((await loadSettings()).positionX).toBe('right');
  });

  it('reports a change together with the updated settings', async () => {
    const onChange = vi.fn<(settings: Settings, key: keyof Settings) => void>();
    const stop = watchSettings(await loadSettings(), onChange);
    await saveSetting('fontSize', 20);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const [settings, key] = onChange.mock.calls[0] ?? [];
    expect(settings?.fontSize).toBe(20);
    expect(key).toBe('fontSize');
    stop();
  });

  it('counts shards into the value unless told otherwise, and remembers the choice', async () => {
    expect((await loadSettings()).excludeShards).toBe(false);
    await saveSetting('excludeShards', true);
    expect((await loadSettings()).excludeShards).toBe(true);
  });

  it('values the total by the bank unless told otherwise, and remembers the choice', async () => {
    expect((await loadSettings()).valueBasis).toBe('bank');
    await saveSetting('valueBasis', 'cards');
    expect((await loadSettings()).valueBasis).toBe('cards');
  });

  it('resets every setting to its default', async () => {
    await saveSetting('opacity', 10);
    await resetSettings();
    expect((await loadSettings()).opacity).toBe(DEFAULT_SETTINGS.opacity);
  });
});
