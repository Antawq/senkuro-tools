export const AVATAR_COST = 5000;
export const MONEY_STICKER = 25;

const SETTINGS_PATH = '/settings/appearance';
const BUTTON = '.edit-media__user + .edit-media__actions > button:first-child';
const MODALS_KEY = 'modals';
const SERVICE_WORKER = '/sw.js';
const CONFIRM_CHUNK = /assets\/BaseConfirmModal-[\w-]+\.js/;

export const CONFIRM_PROPS = {
  title: 'Платная загрузка аватарки',
  description: [
    { type: 'text', text: 'С вашего баланса спишется ' },
    { type: 'mark', text: `${AVATAR_COST} сенкоинов` },
    { type: 'text', text: '. Продолжить?' },
  ],
  sticker: MONEY_STICKER,
};

export interface ModalEntry {
  emitted: (event: string) => Promise<boolean>;
}

export interface SiteModals {
  showModal: (loader: () => Promise<unknown>, props: object, options: object) => ModalEntry;
}

export interface AvatarConfirmHost {
  doc: Document;
  modals: () => SiteModals | null;
  component: () => Promise<unknown>;
}

interface VueHost {
  __vue_app__?: { _context?: { provides?: Record<symbol, unknown> } };
}

const onSettings = (path: string): boolean => path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`);

const isSiteModals = (value: unknown): value is SiteModals => typeof (value as SiteModals | null)?.showModal === 'function';

export function findModals(doc: Document): SiteModals | null {
  const provides = (doc.querySelector('#app') as VueHost | null)?.__vue_app__?._context?.provides;
  if (!provides) return null;
  const key = Object.getOwnPropertySymbols(provides).find((symbol) => symbol.description === MODALS_KEY);
  const modals = key ? provides[key] : null;
  return isSiteModals(modals) ? modals : null;
}

export function createConfirmLoader(
  win: Pick<Window, 'fetch' | 'location'>,
  importModule: (url: string) => Promise<{ default?: unknown }> = (url) => import(url) as Promise<{ default?: unknown }>
): () => Promise<unknown> {
  let loading: Promise<unknown> | null = null;
  const load = async (): Promise<unknown> => {
    const listing = await (await win.fetch(SERVICE_WORKER)).text();
    const chunk = CONFIRM_CHUNK.exec(listing)?.[0];
    if (!chunk) throw new Error('the confirm window of the site was not found');
    const loaded = await importModule(new URL(chunk, win.location.origin).href);
    if (!loaded.default) throw new Error('the confirm window of the site has no component');
    return loaded.default;
  };
  return () => {
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
}

export function installAvatarConfirm({ doc, modals, component }: AvatarConfirmHost): () => void {
  let passing = false;
  let asking = false;

  const proceed = (button: Element): void => {
    passing = true;
    try {
      (button as HTMLElement).click();
    } finally {
      passing = false;
    }
  };

  const ask = async (site: SiteModals): Promise<boolean> => {
    const loaded = await component();
    const entry = site.showModal(() => Promise.resolve(loaded), CONFIRM_PROPS, {});
    return Promise.race([entry.emitted('confirm'), entry.emitted('close').then(() => false)]);
  };

  const onClick = (event: MouseEvent): void => {
    if (passing || !onSettings(doc.location.pathname)) return;
    const button = event.target instanceof Element ? event.target.closest(BUTTON) : null;
    if (!button) return;
    const site = modals();
    if (!site) return;
    event.stopImmediatePropagation();
    if (asking) return;
    asking = true;
    ask(site)
      .then(
        (confirmed) => {
          if (confirmed) proceed(button);
        },
        () => proceed(button)
      )
      .finally(() => {
        asking = false;
      });
  };

  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
