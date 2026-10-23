import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import { APP_MOUNTED_EVENT, POLL_MS, announceMounted, isAppMounted } from '../utils/shared/app-mounted';

type Host = Parameters<typeof announceMounted>[0];

const onFakeClock = (win: Window): Host => {
  win.setTimeout = (run: () => void, ms?: number) => globalThis.setTimeout(run, ms);
  return win as unknown as Host;
};

const page = (): { win: Host; mount: () => void } => {
  const win = onFakeClock(new Window({ url: 'https://senkuro.me/users/x/cards' }));
  win.document.body.innerHTML = '<div id="app"></div>';
  const mount = () => {
    (win.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {};
  };
  return { win, mount };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('announceMounted', () => {
  it('marks the page and says so once the app has mounted, however late', () => {
    const { win, mount } = page();
    const heard = vi.fn();
    win.document.addEventListener(APP_MOUNTED_EVENT, heard);
    announceMounted(win);
    expect(isAppMounted(win.document)).toBe(false);
    vi.advanceTimersByTime(POLL_MS * 5);
    expect(heard).not.toHaveBeenCalled();
    mount();
    vi.advanceTimersByTime(POLL_MS);
    expect(isAppMounted(win.document)).toBe(true);
    expect(heard).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(POLL_MS * 30);
    expect(heard).toHaveBeenCalledOnce();
  });

  it('is told at once when the app was mounted already', () => {
    const { win, mount } = page();
    mount();
    announceMounted(win);
    expect(isAppMounted(win.document)).toBe(true);
  });

  it('waits for the page to draw its root, which may not be there at the start', () => {
    const win = onFakeClock(new Window({ url: 'https://senkuro.me/' }));
    announceMounted(win);
    vi.advanceTimersByTime(POLL_MS * 3);
    expect(isAppMounted(win.document)).toBe(false);
    win.document.body.innerHTML = '<div id="app"></div>';
    (win.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {};
    vi.advanceTimersByTime(POLL_MS);
    expect(isAppMounted(win.document)).toBe(true);
  });

  it('never gives up, however late the app mounts', () => {
    const { win, mount } = page();
    announceMounted(win);
    vi.advanceTimersByTime(POLL_MS * 1000);
    expect(isAppMounted(win.document)).toBe(false);
    mount();
    vi.advanceTimersByTime(POLL_MS);
    expect(isAppMounted(win.document)).toBe(true);
  });

  it('looks only once for a page however often it is asked to', () => {
    const { win, mount } = page();
    const heard = vi.fn();
    win.document.addEventListener(APP_MOUNTED_EVENT, heard);
    announceMounted(win);
    announceMounted(win);
    mount();
    vi.advanceTimersByTime(POLL_MS);
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe('isAppMounted', () => {
  it('is false for a page nobody marked', () => {
    expect(isAppMounted(page().win.document)).toBe(false);
  });
});
