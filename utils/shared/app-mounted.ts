import type { PageWindow } from './page-window';
import { APP_ROOT, findVueApp, watchVueApp } from './vue-app';

export const APP_MOUNTED_EVENT = 'senkutools:app-mounted';
export const APP_MOUNTED_ATTRIBUTE = 'data-senkutools-mounted';

export const isAppMounted = (pageDocument: Document): boolean => pageDocument.documentElement.hasAttribute(APP_MOUNTED_ATTRIBUTE);

export function publishAppMounted(pageWindow: PageWindow): void {
  const publish = (): void => {
    if (isAppMounted(pageWindow.document)) return;
    pageWindow.document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
    pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(APP_MOUNTED_EVENT));
  };
  if (findVueApp(pageWindow.document)) publish();
  else
    watchVueApp(pageWindow, (container) => {
      if (container.matches(APP_ROOT)) publish();
    });
}
