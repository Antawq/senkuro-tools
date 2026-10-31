import type { PageWindow } from './page-window';

export const APP_ROOT = '#app';
const VUE_APP_KEY = '__vue_app__';

export interface SiteHooks {
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
}

export interface VueApp {
  _context?: { provides?: Record<string | symbol, unknown> };
  config?: { globalProperties?: Record<string, unknown> };
  $senkuro?: { hydrating?: unknown; hooks?: Partial<SiteHooks> };
}

export const findVueApp = (pageDocument: Document): VueApp | null =>
  pageDocument.querySelector<Element & { __vue_app__?: VueApp }>(APP_ROOT)?.__vue_app__ ?? null;

export function watchVueApp(pageWindow: PageWindow, onAssigned: (container: Element) => void): void {
  const prototype = pageWindow.Element.prototype;
  const previous = Object.getOwnPropertyDescriptor(prototype, VUE_APP_KEY);
  Object.defineProperty(prototype, VUE_APP_KEY, {
    configurable: true,
    set(this: Element, app: unknown) {
      previous?.set?.call(this, app);
      Object.defineProperty(this, VUE_APP_KEY, { value: app, writable: true, configurable: true, enumerable: true });
      onAssigned(this);
    },
  });
}

export function runOnAppAssigned(pageWindow: PageWindow, run: (app: VueApp) => void): void {
  const app = findVueApp(pageWindow.document);
  if (app) return run(app);
  let hasAssigned = false;
  watchVueApp(pageWindow, (container) => {
    const assigned = !hasAssigned && container.matches(APP_ROOT) ? findVueApp(pageWindow.document) : null;
    if (!assigned) return;
    hasAssigned = true;
    run(assigned);
  });
}
