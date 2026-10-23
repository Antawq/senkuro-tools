export const AVATAR_COST_SENKOINS = 5000;
export const MONEY_STICKER_ID = 25;
export const COIN_ALT = 'сенкоинов';
export const COIN_CLASS = 'senkutools-avatar-coin';

const BUTTON = '.edit-media__user + .edit-media__actions > button:first-child';
const MODALS_KEY = 'modals';
const SERVICE_WORKER = '/sw.js';
const CONFIRM_CHUNK = /assets\/BaseConfirmModal-[\w-]+\.js/;
const COIN_IMAGE = /assets\/money-3d-[\w-]+\.png/;
const COST_MARK = '.modal-alert__desc span';

export const createConfirmProps = (hasCoin: boolean) => ({
  title: 'Платная загрузка аватарки',
  description: [
    { type: 'text', text: 'С вашего баланса спишется ' },
    { type: 'mark', text: hasCoin ? String(AVATAR_COST_SENKOINS) : `${AVATAR_COST_SENKOINS} ${COIN_ALT}` },
    { type: 'text', text: '. Продолжить?' },
  ],
  sticker: MONEY_STICKER_ID,
});

export interface ModalEntry {
  emitted: (event: string) => Promise<boolean>;
}

export interface SiteModals {
  showModal: (loader: () => Promise<unknown>, props: object, options: object) => ModalEntry;
}

export interface SiteAssets {
  loadConfirmComponent: () => Promise<unknown>;
  findCoinUrl: () => Promise<string | null>;
}

interface AvatarConfirmHost {
  pageDocument: Document;
  findSiteModals: () => SiteModals | null;
  assets: SiteAssets;
}

interface VueHost {
  __vue_app__?: { _context?: { provides?: Record<symbol, unknown> } };
}

const isSiteModals = (value: unknown): value is SiteModals => typeof (value as SiteModals | null)?.showModal === 'function';

export function findSiteModals(pageDocument: Document): SiteModals | null {
  const provides = (pageDocument.querySelector('#app') as VueHost | null)?.__vue_app__?._context?.provides;
  if (!provides) return null;
  const key = Object.getOwnPropertySymbols(provides).find((symbol) => symbol.description === MODALS_KEY);
  const modals = key ? provides[key] : null;
  return isSiteModals(modals) ? modals : null;
}

export function createSiteAssets(
  pageWindow: Pick<Window, 'fetch' | 'location'>,
  importModule: (url: string) => Promise<{ default?: unknown }> = (url) => import(url) as Promise<{ default?: unknown }>
): SiteAssets {
  let precacheListing: Promise<string> | null = null;
  let confirmComponentPromise: Promise<unknown> | null = null;

  const fetchPrecacheListing = (): Promise<string> => {
    precacheListing ??= pageWindow
      .fetch(SERVICE_WORKER)
      .then((response) => {
        if (!response.ok) throw new Error(`${SERVICE_WORKER}: HTTP ${response.status}`);
        return response.text();
      })
      .catch((error: unknown) => {
        precacheListing = null;
        throw error;
      });
    return precacheListing;
  };

  const findAssetUrl = async (pattern: RegExp): Promise<string | null> => {
    const path = pattern.exec(await fetchPrecacheListing())?.[0];
    return path ? new URL(path, pageWindow.location.origin).href : null;
  };

  const importConfirmComponent = async (): Promise<unknown> => {
    const url = await findAssetUrl(CONFIRM_CHUNK);
    if (!url) throw new Error('the confirm window of the site was not found');
    const importedModule = await importModule(url);
    if (!importedModule.default) throw new Error('the confirm window of the site has no component');
    return importedModule.default;
  };

  return {
    loadConfirmComponent: () => {
      confirmComponentPromise ??= importConfirmComponent().catch((error: unknown) => {
        confirmComponentPromise = null;
        throw error;
      });
      return confirmComponentPromise;
    },
    findCoinUrl: () => findAssetUrl(COIN_IMAGE).catch(() => null),
  };
}

const createCoin = (pageDocument: Document, url: string): HTMLImageElement => {
  const coin = pageDocument.createElement('img');
  coin.src = url;
  coin.alt = COIN_ALT;
  coin.className = COIN_CLASS;
  return coin;
};

const addCoinToCostMark = (pageDocument: Document, url: string | null): (() => void) => {
  if (!url) return () => undefined;
  const appendMissingCoins = (): void => {
    for (const mark of pageDocument.querySelectorAll(COST_MARK)) {
      if (mark.textContent === String(AVATAR_COST_SENKOINS) && !mark.querySelector('img')) mark.append(createCoin(pageDocument, url));
    }
  };
  const observer = new MutationObserver(appendMissingCoins);
  observer.observe(pageDocument.body, { childList: true, subtree: true });
  return () => observer.disconnect();
};

export function installAvatarConfirm({ pageDocument, findSiteModals, assets }: AvatarConfirmHost): () => void {
  let isReplayingClick = false;
  let isAsking = false;

  const replayClick = (button: Element): void => {
    isReplayingClick = true;
    try {
      (button as HTMLElement).click();
    } finally {
      isReplayingClick = false;
    }
  };

  const ask = async (siteModals: SiteModals): Promise<boolean> => {
    const [confirmComponent, coinUrl] = await Promise.all([assets.loadConfirmComponent(), assets.findCoinUrl()]);
    const stopAddingCoin = addCoinToCostMark(pageDocument, coinUrl);
    try {
      const entry = siteModals.showModal(() => Promise.resolve(confirmComponent), createConfirmProps(coinUrl !== null), {});
      return await Promise.race([entry.emitted('confirm'), entry.emitted('close').then(() => false)]);
    } finally {
      stopAddingCoin();
    }
  };

  const handleClick = (event: MouseEvent): void => {
    if (isReplayingClick) return;
    const button = event.target instanceof Element ? event.target.closest(BUTTON) : null;
    if (!button) return;
    const siteModals = findSiteModals();
    if (!siteModals) return;
    event.stopImmediatePropagation();
    if (isAsking) return;
    isAsking = true;
    ask(siteModals)
      .then(
        (isConfirmed) => {
          if (isConfirmed) replayClick(button);
        },
        () => replayClick(button)
      )
      .finally(() => {
        isAsking = false;
      });
  };

  pageDocument.addEventListener('click', handleClick, true);
  return () => pageDocument.removeEventListener('click', handleClick, true);
}
