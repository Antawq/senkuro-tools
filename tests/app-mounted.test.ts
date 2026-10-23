import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import { APP_MOUNTED_EVENT, POLL_MS, announceMounted, isAppMounted } from '../utils/shared/app-mounted';

type PageWindow = Parameters<typeof announceMounted>[0];

const onFakeClock = (pageWindow: Window): PageWindow => {
  pageWindow.setTimeout = (run: () => void, ms?: number) => globalThis.setTimeout(run, ms);
  return pageWindow as unknown as PageWindow;
};

const page = (): { pageWindow: PageWindow; mount: () => void } => {
  const pageWindow = onFakeClock(new Window({ url: 'https://senkuro.me/users/x/cards' }));
  pageWindow.document.body.innerHTML = '<div id="app"></div>';
  const mount = () => {
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {};
  };
  return { pageWindow, mount };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('announceMounted', () => {
  it('marks the page and says so once the app has mounted, however late', () => {
    const { pageWindow, mount } = page();
    const heard = vi.fn();
    pageWindow.document.addEventListener(APP_MOUNTED_EVENT, heard);
    announceMounted(pageWindow);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    vi.advanceTimersByTime(POLL_MS * 5);
    expect(heard).not.toHaveBeenCalled();
    mount();
    vi.advanceTimersByTime(POLL_MS);
    expect(isAppMounted(pageWindow.document)).toBe(true);
    expect(heard).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(POLL_MS * 30);
    expect(heard).toHaveBeenCalledOnce();
  });

  it('is told at once when the app was mounted already', () => {
    const { pageWindow, mount } = page();
    mount();
    announceMounted(pageWindow);
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('waits for the page to draw its root, which may not be there at the start', () => {
    const pageWindow = onFakeClock(new Window({ url: 'https://senkuro.me/' }));
    announceMounted(pageWindow);
    vi.advanceTimersByTime(POLL_MS * 3);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {};
    vi.advanceTimersByTime(POLL_MS);
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('never gives up, however late the app mounts', () => {
    const { pageWindow, mount } = page();
    announceMounted(pageWindow);
    vi.advanceTimersByTime(POLL_MS * 1000);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    mount();
    vi.advanceTimersByTime(POLL_MS);
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('looks only once for a page however often it is asked to', () => {
    const { pageWindow, mount } = page();
    const heard = vi.fn();
    pageWindow.document.addEventListener(APP_MOUNTED_EVENT, heard);
    announceMounted(pageWindow);
    announceMounted(pageWindow);
    mount();
    vi.advanceTimersByTime(POLL_MS);
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe('isAppMounted', () => {
  it('is false for a page nobody marked', () => {
    expect(isAppMounted(page().pageWindow.document)).toBe(false);
  });
});
