const APP_ROOT = '#app';
export const VUE_APP_KEY = '__vue_app__';

export interface VueApp {
  _context?: { provides?: Record<string, unknown> };
  config?: { globalProperties?: Record<string, unknown> };
}

export const findVueApp = (pageDocument: Document): VueApp | null =>
  pageDocument.querySelector<Element & { __vue_app__?: VueApp }>(APP_ROOT)?.__vue_app__ ?? null;
