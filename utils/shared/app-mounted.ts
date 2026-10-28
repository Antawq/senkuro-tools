import type { PageWindow } from './page-window';
import { APP_ROOT, findVueApp, watchVueApp, type SiteHooks, type VueApp } from './vue-app';

export const APP_MOUNTED_EVENT = 'senkutools:app-mounted';
export const APP_MOUNTED_ATTRIBUTE = 'data-senkutools-mounted';

const HYDRATION_DONE = 'app:suspense:resolve';

export const isAppMounted = (pageDocument: Document): boolean => pageDocument.documentElement.hasAttribute(APP_MOUNTED_ATTRIBUTE);

const hydratingHooksOf = (app: VueApp): SiteHooks | null => {
  const site = app.$senkuro;
  const hooks = site?.hooks;
  return site?.hydrating === true && typeof hooks?.on === 'function' && typeof hooks.off === 'function' ? (hooks as SiteHooks) : null;
};

function runWhenHydrated(app: VueApp, run: (app: VueApp) => void): void {
  const hooks = hydratingHooksOf(app);
  if (!hooks) return run(app);
  const handleHydrationDone = (): void => {
    hooks.off(HYDRATION_DONE, handleHydrationDone);
    run(app);
  };
  hooks.on(HYDRATION_DONE, handleHydrationDone);
}

export function runAfterHydration(pageWindow: PageWindow, run: (app: VueApp) => void): void {
  const app = findVueApp(pageWindow.document);
  if (app) return runWhenHydrated(app, run);
  let hasMounted = false;
  watchVueApp(pageWindow, (container) => {
    const mounted = !hasMounted && container.matches(APP_ROOT) ? findVueApp(pageWindow.document) : null;
    if (!mounted) return;
    hasMounted = true;
    runWhenHydrated(mounted, run);
  });
}

export function publishAppMounted(pageWindow: PageWindow): void {
  runAfterHydration(pageWindow, () => {
    if (isAppMounted(pageWindow.document)) return;
    pageWindow.document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
    pageWindow.document.dispatchEvent(new pageWindow.CustomEvent(APP_MOUNTED_EVENT));
  });
}
