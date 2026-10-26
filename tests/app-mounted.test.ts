import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import { APP_MOUNTED_EVENT, publishAppMounted, isAppMounted } from '../utils/shared/app-mounted';

type PageWindow = Parameters<typeof publishAppMounted>[0];

const createPage = (html = '<div id="app"></div><div id="other"></div>'): { pageWindow: PageWindow; mount: (selector?: string) => void } => {
  const pageWindow = new Window({ url: 'https://senkuro.me/users/x/cards' }) as unknown as PageWindow;
  pageWindow.document.body.innerHTML = html;
  const mount = (selector = '#app') => {
    (pageWindow.document.querySelector(selector) as unknown as { __vue_app__: unknown }).__vue_app__ = {};
  };
  return { pageWindow, mount };
};

describe('publishAppMounted', () => {
  it('marks the page and says so the moment the app mounts', () => {
    const { pageWindow, mount } = createPage();
    const handleAppMounted = vi.fn();
    pageWindow.document.addEventListener(APP_MOUNTED_EVENT, handleAppMounted);
    publishAppMounted(pageWindow);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    expect(handleAppMounted).not.toHaveBeenCalled();
    mount();
    expect(isAppMounted(pageWindow.document)).toBe(true);
    expect(handleAppMounted).toHaveBeenCalledOnce();
  });

  it('is told at once when the app was mounted already', () => {
    const { pageWindow, mount } = createPage();
    mount();
    publishAppMounted(pageWindow);
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('waits for the page to draw its root, which may not be there at the start', () => {
    const { pageWindow, mount } = createPage('');
    publishAppMounted(pageWindow);
    expect(isAppMounted(pageWindow.document)).toBe(false);
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    mount();
    expect(isAppMounted(pageWindow.document)).toBe(true);
  });

  it('ignores an app mounted on another element', () => {
    const { pageWindow, mount } = createPage();
    publishAppMounted(pageWindow);
    mount('#other');
    expect(isAppMounted(pageWindow.document)).toBe(false);
  });

  it('says so once for a page however often it is asked to', () => {
    const { pageWindow, mount } = createPage();
    const handleAppMounted = vi.fn();
    pageWindow.document.addEventListener(APP_MOUNTED_EVENT, handleAppMounted);
    publishAppMounted(pageWindow);
    publishAppMounted(pageWindow);
    mount();
    expect(handleAppMounted).toHaveBeenCalledOnce();
  });
});

describe('isAppMounted', () => {
  it('is false for a page nobody marked', () => {
    expect(isAppMounted(createPage().pageWindow.document)).toBe(false);
  });
});
