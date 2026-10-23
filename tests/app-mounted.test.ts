import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import { APP_MOUNTED_EVENT, APP_MOUNT_POLL_MS, publishAppMounted, isAppMounted } from '../utils/shared/app-mounted';

type PageWindow = Parameters<typeof publishAppMounted>[0];

const useGlobalTimers = (pageWindow: Window): PageWindow => {
  pageWindow.setTimeout = (run: () => void, ms?: number) => globalThis.setTimeout(run, ms);
  return pageWindow as unknown as PageWindow;
};

const createPage = (): { pageWindow: PageWindow; mount: () => void } => {
  const pageWindow = useGlobalTimers(new Window({ url: 'https://senkuro.me/users/x/cards' }));
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

describe('publishAppMounted', () => {
  it('marks the page and says so once the app has mounted, however late', () => {
    const { pageWindow, mount } = createPage();
    const handleAppMounted = vi.fn();
    pageWindow.document.addEventListener(APP_MOUNTED_EVENT, handleAppMounted);
    publishAppMounted(pageWindow);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS * 5);
    expect(handleAppMounted).not.toHaveBeenCalled();
    mount();
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS);
    expect(isAppMounted(pageWindow.document)).toBe(true);
    expect(handleAppMounted).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS * 30);
    expect(handleAppMounted).toHaveBeenCalledOnce();
  });

  it('is told at once when the app was mounted already', () => {
    const { pageWindow, mount } = createPage();
    mount();
    publishAppMounted(pageWindow);
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('waits for the page to draw its root, which may not be there at the start', () => {
    const pageWindow = useGlobalTimers(new Window({ url: 'https://senkuro.me/' }));
    publishAppMounted(pageWindow);
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS * 3);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    (pageWindow.document.querySelector('#app') as unknown as { __vue_app__: unknown }).__vue_app__ = {};
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS);
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('never gives up, however late the app mounts', () => {
    const { pageWindow, mount } = createPage();
    publishAppMounted(pageWindow);
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS * 1000);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    mount();
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS);
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('looks only once for a page however often it is asked to', () => {
    const { pageWindow, mount } = createPage();
    const handleAppMounted = vi.fn();
    pageWindow.document.addEventListener(APP_MOUNTED_EVENT, handleAppMounted);
    publishAppMounted(pageWindow);
    publishAppMounted(pageWindow);
    mount();
    vi.advanceTimersByTime(APP_MOUNT_POLL_MS);
    expect(handleAppMounted).toHaveBeenCalledOnce();
  });
});

describe('isAppMounted', () => {
  it('is false for a page nobody marked', () => {
    expect(isAppMounted(createPage().pageWindow.document)).toBe(false);
  });
});
