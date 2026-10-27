import type { PageWindow } from './page-window';

export const APP_ROOT = '#app';
const VUE_APP_KEY = '__vue_app__';

export interface VueApp {
  _context?: { provides?: Record<string | symbol, unknown> };
  config?: { globalProperties?: Record<string, unknown> };
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
