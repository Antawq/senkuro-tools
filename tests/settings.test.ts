import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DEFAULT_SETTINGS, loadSettings, resetSettings, saveSetting, watchSettings, type Settings } from '../utils/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings', () => {
  it('falls back to the defaults the popup shows', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps values saved by earlier versions under the same keys', async () => {
    await fakeBrowser.storage.local.set({ position: 'top-left', copyBtn: true });
    const settings = await loadSettings();
    expect(settings.position).toBe('top-left');
    expect(settings.copyBtn).toBe(true);
    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
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

  it('resets every setting to its default', async () => {
    await saveSetting('opacity', 10);
    await resetSettings();
    expect((await loadSettings()).opacity).toBe(DEFAULT_SETTINGS.opacity);
  });
});
