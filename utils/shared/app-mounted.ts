export const APP_MOUNTED_EVENT = 'senkutools:app-mounted';
export const APP_MOUNTED_ATTRIBUTE = 'data-senkutools-mounted';
export const POLL_MS = 100;

const APP_ROOT = '#app';

type PageWindow = Window & typeof globalThis;

type AppRoot = Element & { __vue_app__?: unknown };

export const isAppMounted = (doc: Document): boolean => doc.documentElement.hasAttribute(APP_MOUNTED_ATTRIBUTE);

export function announceMounted(win: PageWindow): void {
  const look = (): void => {
    if (isAppMounted(win.document)) return;
    if (win.document.querySelector<AppRoot>(APP_ROOT)?.__vue_app__ !== undefined) {
      win.document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
      win.document.dispatchEvent(new win.CustomEvent(APP_MOUNTED_EVENT));
      return;
    }
    win.setTimeout(look, POLL_MS);
  };
  look();
}
