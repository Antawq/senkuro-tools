import { describe, expect, it, vi } from 'vitest';

import { Window } from 'happy-dom';

import { runOnAppAssigned } from '../utils/shared/vue-app';

type PageWindow = Parameters<typeof runOnAppAssigned>[0];

const createPage = (html = '<div id="app"></div><div id="other"></div>'): { pageWindow: PageWindow; assign: (app: unknown, selector?: string) => void } => {
  const pageWindow = new Window({ url: 'https://senkuro.me/browse/manga' }) as unknown as PageWindow;
  pageWindow.document.body.innerHTML = html;
  const assign = (app: unknown, selector = '#app') => {
    (pageWindow.document.querySelector(selector) as unknown as { __vue_app__: unknown }).__vue_app__ = app;
  };
  return { pageWindow, assign };
};

describe('runOnAppAssigned', () => {
  it('runs with the app the moment the site assigns it to its root, hydrating or not', () => {
    const { pageWindow, assign } = createPage();
    const run = vi.fn();
    runOnAppAssigned(pageWindow, run);
    expect(run).not.toHaveBeenCalled();
    const app = { $senkuro: { hydrating: true } };
    assign(app);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(app);
  });

  it('runs at once for an app assigned before the script ran', () => {
    const { pageWindow, assign } = createPage();
    const app = {};
    assign(app);
    const run = vi.fn();
    runOnAppAssigned(pageWindow, run);
    expect(run).toHaveBeenCalledExactlyOnceWith(app);
  });

  it('ignores an app assigned to another element, and runs only for the first app of the root', () => {
    const { pageWindow, assign } = createPage();
    const run = vi.fn();
    runOnAppAssigned(pageWindow, run);
    assign({}, '#other');
    expect(run).not.toHaveBeenCalled();
    const first = {};
    assign(first);
    assign({});
    expect(run).toHaveBeenCalledExactlyOnceWith(first);
  });

  it('waits for the page to draw its root, which may not be there at the start', () => {
    const { pageWindow, assign } = createPage('');
    const run = vi.fn();
    runOnAppAssigned(pageWindow, run);
    pageWindow.document.body.innerHTML = '<div id="app"></div>';
    assign({});
    expect(run).toHaveBeenCalledOnce();
  });
});
