import type { PageWindow } from './page-window';

export const APP_MOUNTED_EVENT = 'senkutools:app-mounted';
export const APP_MOUNTED_ATTRIBUTE = 'data-senkutools-mounted';
export const APP_MOUNT_POLL_MS = 100;

const APP_ROOT = '#app';

type AppRoot = Element & { __vue_app__?: unknown };

export const isAppMounted = (pageDocument: Document): boolean => pageDocument.documentElement.hasAttribute(APP_MOUNTED_ATTRIBUTE);

export function publishAppMounted(pageWindow: PageWindow): void {
  const lookForMountedApp = (): void => {
    if (isAppMounted(pageWindow.document)) return;
    if (pageWindow.document.querySelector<AppRoot>(APP_ROOT)?.__vue_app__ !== undefined) {
      pageWindow.document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
      pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(APP_MOUNTED_EVENT));
      return;
    }
    pageWindow.setTimeout(lookForMountedApp, APP_MOUNT_POLL_MS);
  };
  lookForMountedApp();
}
