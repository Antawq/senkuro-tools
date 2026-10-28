import type { PageWindow } from './page-window';
import { APP_ROOT, findVueApp, watchVueApp, type SiteHooks, type VueApp } from './vue-app';

export const APP_MOUNTED_EVENT = 'senkutools:app-mounted';
export const APP_MOUNTED_ATTRIBUTE = 'data-senkutools-mounted';

const HYDRATION_DONE = 'app:suspense:resolve';

export const isAppMounted = (pageDocument: Document): boolean => pageDocument.documentElement.hasAttribute(APP_MOUNTED_ATTRIBUTE);

const hydratingHooksOf = (app: VueApp | null): SiteHooks | null => {
  const site = app?.$senkuro;
  const hooks = site?.hooks;
  return site?.hydrating === true && typeof hooks?.on === 'function' && typeof hooks.off === 'function' ? (hooks as SiteHooks) : null;
};

function publishAfterHydration(app: VueApp | null, publish: () => void): void {
  const hooks = hydratingHooksOf(app);
  if (!hooks) return publish();
  const handleHydrationDone = (): void => {
    hooks.off(HYDRATION_DONE, handleHydrationDone);
    publish();
  };
  hooks.on(HYDRATION_DONE, handleHydrationDone);
}

export function publishAppMounted(pageWindow: PageWindow): void {
  const publish = (): void => {
    if (isAppMounted(pageWindow.document)) return;
    pageWindow.document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
    pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(APP_MOUNTED_EVENT));
  };
  const app = findVueApp(pageWindow.document);
  if (app) publishAfterHydration(app, publish);
  else
    watchVueApp(pageWindow, (container) => {
      if (container.matches(APP_ROOT)) publishAfterHydration(findVueApp(pageWindow.document), publish);
    });
}
