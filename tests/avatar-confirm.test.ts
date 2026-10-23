import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AVATAR_COST_SENKOINS,
  COIN_ALT,
  COIN_CLASS,
  MONEY_STICKER_ID,
  createConfirmProps,
  createSiteAssets,
  findSiteModals,
  installAvatarConfirm,
  type ModalEntry,
  type SiteAssets,
  type SiteModals,
} from '../utils/avatar/avatar-confirm';

const APPEARANCE_SECTION_HTML = `
  <div class="edit-media"><div class="edit-media__banner"></div><div class="edit-media__actions"><button id="banner">Баннер</button></div></div>
  <div class="edit-media">
    <div class="edit-media__user"></div>
    <div class="edit-media__actions"><button id="upload"><span>Заменить</span></button><button id="remove">Снять</button></div>
  </div>`;

const COIN_URL = 'https://senkuro.me/assets/money-3d-D_1Eg9LH.png';
const COMPONENT = { name: 'BaseConfirmModal' };

const uploadButton = () => document.getElementById('upload') as HTMLElement;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const costMarks = () => [...document.querySelectorAll('.modal-alert__desc span')];

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

interface ShownModal {
  confirmComponent: unknown;
  props: { description: { type: string; text: string }[] };
  options: object;
}

let siteClicks: string[];
let answer: ReturnType<typeof deferred<boolean>>;
let closed: ReturnType<typeof deferred<boolean>>;
let shownModals: ShownModal[];
let awaitedEvents: string[];
let siteModals: SiteModals | null;
let assets: SiteAssets;
let dispose: () => void;

const handleSiteClick = (event: Event) => siteClicks.push((event.target as Element).closest('button')?.id ?? '');

const mountModal = (costText: string) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="modal-alert"><div class="modal-alert__desc">С вашего баланса спишется <span>${costText}</span>. Продолжить?</div></div>`
  );
};

beforeEach(() => {
  document.body.innerHTML = APPEARANCE_SECTION_HTML;
  siteClicks = [];
  shownModals = [];
  awaitedEvents = [];
  answer = deferred<boolean>();
  closed = deferred<boolean>();
  siteModals = {
    showModal: (loader, props, options) => {
      void loader().then((confirmComponent) => shownModals.push({ confirmComponent, props: props as ShownModal['props'], options }));
      queueMicrotask(() => mountModal((props as ShownModal['props']).description[1]?.text ?? ''));
      const entry: ModalEntry = {
        emitted: (event) => {
          awaitedEvents.push(event);
          return event === 'confirm' ? answer.promise : closed.promise;
        },
      };
      return entry;
    },
  };
  assets = { loadConfirmComponent: () => Promise.resolve(COMPONENT), findCoinUrl: () => Promise.resolve(COIN_URL) };
  document.addEventListener('click', handleSiteClick);
  dispose = installAvatarConfirm({
    pageDocument: document,
    findSiteModals: () => siteModals,
    assets: { loadConfirmComponent: () => assets.loadConfirmComponent(), findCoinUrl: () => assets.findCoinUrl() },
  });
});

afterEach(async () => {
  answer.resolve(false);
  await flush();
  dispose();
  document.removeEventListener('click', handleSiteClick);
  document.body.innerHTML = '';
});

describe('the warning before an avatar upload', () => {
  it('holds the click and shows the confirm window of the site instead', async () => {
    uploadButton().click();
    await flush();
    expect(siteClicks).toEqual([]);
    expect(shownModals).toHaveLength(1);
    expect(shownModals[0]?.confirmComponent).toBe(COMPONENT);
  });

  it('waits for the confirmation and for the window being closed', async () => {
    uploadButton().click();
    await flush();
    expect(awaitedEvents).toEqual(['confirm', 'close']);
  });

  it('shows the money sticker and says the price, with the amount marked as the site marks its own', async () => {
    uploadButton().click();
    await flush();
    expect(MONEY_STICKER_ID).toBe(25);
    expect(AVATAR_COST_SENKOINS).toBe(5000);
    expect(shownModals[0]?.props).toEqual(createConfirmProps(true));
    expect(createConfirmProps(true).sticker).toBe(MONEY_STICKER_ID);
    expect(createConfirmProps(true).title).toBe('Платная загрузка аватарки');
    expect(createConfirmProps(true).description).toEqual([
      { type: 'text', text: 'С вашего баланса спишется ' },
      { type: 'mark', text: String(AVATAR_COST_SENKOINS) },
      { type: 'text', text: '. Продолжить?' },
    ]);
  });

  it('lets the upload go on once it is confirmed', async () => {
    uploadButton().click();
    await flush();
    answer.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('stops the upload when the window is cancelled or closed', async () => {
    uploadButton().click();
    await flush();
    answer.resolve(false);
    await flush();
    expect(siteClicks).toEqual([]);
  });

  it('stops the upload at once when the window says it is closing, before its fade has finished', async () => {
    uploadButton().click();
    await flush();
    closed.resolve(true);
    await flush();
    expect(siteClicks).toEqual([]);
    answer = deferred<boolean>();
    closed = deferred<boolean>();
    uploadButton().click();
    await flush();
    expect(shownModals).toHaveLength(2);
  });

  it('goes on when the window reports the confirmation first and its closing right after', async () => {
    uploadButton().click();
    await flush();
    answer.resolve(true);
    closed.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('asks again on the next click', async () => {
    uploadButton().click();
    await flush();
    answer.resolve(false);
    await flush();
    answer = deferred<boolean>();
    uploadButton().click();
    await flush();
    expect(shownModals).toHaveLength(2);
    answer.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('shows one window however often the button is pressed meanwhile, and goes on once', async () => {
    uploadButton().click();
    uploadButton().click();
    uploadButton().click();
    await flush();
    expect(shownModals).toHaveLength(1);
    answer.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('holds a click on what is inside the button too', async () => {
    (uploadButton().querySelector('span') as HTMLElement).click();
    await flush();
    expect(siteClicks).toEqual([]);
    expect(shownModals).toHaveLength(1);
  });

  it('is only the avatar button, not the button beside it nor the banner', async () => {
    document.getElementById('remove')?.click();
    document.getElementById('banner')?.click();
    await flush();
    expect(siteClicks).toEqual(['remove', 'banner']);
    expect(shownModals).toHaveLength(0);
  });

  it('stops asking once it is switched off', async () => {
    dispose();
    uploadButton().click();
    await flush();
    expect(siteClicks).toEqual(['upload']);
    expect(shownModals).toHaveLength(0);
  });
});

describe('the 3D coin in place of the word', () => {
  it('puts the coin of the site after the amount, with the word as its alternative text', async () => {
    uploadButton().click();
    await flush();
    const coin = costMarks()[0]?.querySelector('img');
    expect(costMarks()[0]?.textContent).toBe(String(AVATAR_COST_SENKOINS));
    expect(coin?.getAttribute('src')).toBe(COIN_URL);
    expect(coin?.getAttribute('alt')).toBe(COIN_ALT);
  });

  it('leaves the size of the coin to the stylesheet of the extension', async () => {
    uploadButton().click();
    await flush();
    const coin = costMarks()[0]?.querySelector('img');
    expect(coin?.className).toBe(COIN_CLASS);
    expect(coin?.getAttribute('style')).toBeNull();
  });

  it('puts one coin however often the window changes', async () => {
    uploadButton().click();
    await flush();
    document.querySelector('.modal-alert')?.insertAdjacentHTML('beforeend', '<i></i>');
    await flush();
    expect(costMarks()[0]?.querySelectorAll('img')).toHaveLength(1);
  });

  it('leaves other windows alone, such as the confirmation of age', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="modal-alert"><div class="modal-alert__desc">для <span>взрослых</span> и <span>5000</span> и <span>15000 штук</span></div></div>'
    );
    document.body.insertAdjacentHTML('beforeend', '<div class="elsewhere"><span>5000</span></div>');
    uploadButton().click();
    await flush();
    const spans = [...document.querySelectorAll('span')].filter((span) => span.querySelector('img'));
    expect(spans).toHaveLength(2);
    expect(document.querySelector('.elsewhere span')?.querySelector('img')).toBeNull();
    expect(
      costMarks()
        .find((span) => span.textContent === 'взрослых')
        ?.querySelector('img')
    ).toBeNull();
    expect(
      costMarks()
        .find((span) => span.textContent === '15000 штук')
        ?.querySelector('img')
    ).toBeNull();
  });

  it('says the word instead when the coin cannot be found, and puts no picture', async () => {
    assets = { loadConfirmComponent: () => Promise.resolve(COMPONENT), findCoinUrl: () => Promise.resolve(null) };
    uploadButton().click();
    await flush();
    expect(shownModals[0]?.props).toEqual(createConfirmProps(false));
    expect(createConfirmProps(false).description[1]?.text).toBe(`${AVATAR_COST_SENKOINS} ${COIN_ALT}`);
    expect(costMarks()[0]?.textContent).toBe(`${AVATAR_COST_SENKOINS} ${COIN_ALT}`);
    expect(document.querySelector('img')).toBeNull();
  });

  it('stops looking for the window once the question is answered', async () => {
    uploadButton().click();
    await flush();
    answer.resolve(false);
    await flush();
    mountModal(String(AVATAR_COST_SENKOINS));
    await flush();
    expect(costMarks().at(-1)?.querySelector('img')).toBeNull();
  });

  it('puts the coin in the window it asked for even when that window is slow to appear', async () => {
    siteModals = {
      showModal: (loader, props) => {
        void loader();
        setTimeout(() => mountModal((props as ShownModal['props']).description[1]?.text ?? ''), 20);
        return { emitted: (event) => (event === 'confirm' ? answer.promise : closed.promise) };
      },
    };
    uploadButton().click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(costMarks()[0]?.querySelector('img')).not.toBeNull();
  });
});

describe('when the window of the site cannot be reached, the upload is not blocked', () => {
  it('does not even hold the click when the site has no modal controller', () => {
    siteModals = null;
    uploadButton().click();
    expect(siteClicks).toEqual(['upload']);
  });

  it('goes on when the window cannot be loaded', async () => {
    assets = { loadConfirmComponent: () => Promise.reject(new Error('offline')), findCoinUrl: () => Promise.resolve(COIN_URL) };
    uploadButton().click();
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('goes on when the controller refuses to show it', async () => {
    siteModals = {
      showModal: () => {
        throw new Error('no container');
      },
    };
    uploadButton().click();
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('can ask again after a failure', async () => {
    assets = { loadConfirmComponent: () => Promise.reject(new Error('offline')), findCoinUrl: () => Promise.resolve(COIN_URL) };
    uploadButton().click();
    await flush();
    assets = { loadConfirmComponent: () => Promise.resolve(COMPONENT), findCoinUrl: () => Promise.resolve(COIN_URL) };
    uploadButton().click();
    await flush();
    expect(shownModals).toHaveLength(1);
  });
});

describe('finding the modal controller of the site', () => {
  const appWith = (provides: Record<symbol, unknown>) => {
    document.body.innerHTML = '<div id="app"></div>';
    Object.assign(document.getElementById('app') as object, { __vue_app__: { _context: { provides } } });
  };

  it('takes the one the app provides under the modals symbol', () => {
    const controller = { showModal: () => ({ emitted: () => Promise.resolve(true) }) };
    appWith({ [Symbol('urql')]: {}, [Symbol('modals')]: controller, [Symbol('snackbar')]: {} });
    expect(findSiteModals(document)).toBe(controller);
  });

  it.each([
    ['no app mounted', () => (document.body.innerHTML = '')],
    ['a page without Vue', () => (document.body.innerHTML = '<div id="app"></div>')],
    ['an app that provides nothing like it', () => appWith({ [Symbol('urql')]: {} })],
    ['a modals entry that cannot show anything', () => appWith({ [Symbol('modals')]: { queue: [] } })],
    ['a modals entry that is empty', () => appWith({ [Symbol('modals')]: null })],
  ])('finds nothing with %s', (_name, setup) => {
    setup();
    expect(findSiteModals(document)).toBeNull();
  });
});

describe('loading the confirm window and the coin of the site', () => {
  const serviceWorkerSource =
    'precache([{url:"assets/BaseButton-Ab12.js"},{url:"assets/BaseConfirmModal-Dw121HiH.js"},{url:"assets/money-3d-D_1Eg9LH.png"},{url:"assets/other.js"}])';
  const createPageWindow = (text: string) => ({
    fetch: vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(text) } as Response)),
    location: { origin: 'https://senkuro.me' } as Location,
  });

  it('reads the chunk of the window from the service worker list and imports it from the site', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const pageWindow = createPageWindow(serviceWorkerSource);
    expect(await createSiteAssets(pageWindow, importer).loadConfirmComponent()).toBe(COMPONENT);
    expect(pageWindow.fetch).toHaveBeenCalledWith('/sw.js');
    expect(importer).toHaveBeenCalledWith('https://senkuro.me/assets/BaseConfirmModal-Dw121HiH.js');
  });

  it('reads the picture of the coin from the same list', async () => {
    expect(await createSiteAssets(createPageWindow(serviceWorkerSource)).findCoinUrl()).toBe(COIN_URL);
  });

  it('reads the list once for both, however often they are asked', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const pageWindow = createPageWindow(serviceWorkerSource);
    const siteAssets = createSiteAssets(pageWindow, importer);
    await Promise.all([siteAssets.loadConfirmComponent(), siteAssets.loadConfirmComponent(), siteAssets.findCoinUrl()]);
    await siteAssets.loadConfirmComponent();
    await siteAssets.findCoinUrl();
    expect(pageWindow.fetch).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('finds no coin when the list names none, or cannot be read, and never fails for it', async () => {
    expect(await createSiteAssets(createPageWindow('precache([])')).findCoinUrl()).toBeNull();
    const brokenPageWindow = { fetch: vi.fn(() => Promise.reject(new Error('offline'))), location: { origin: 'https://senkuro.me' } as Location };
    expect(await createSiteAssets(brokenPageWindow).findCoinUrl()).toBeNull();
  });

  it('fails when the list names no such chunk, and tries again next time', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const pageWindow = createPageWindow('precache([])');
    const siteAssets = createSiteAssets(pageWindow, importer);
    await expect(siteAssets.loadConfirmComponent()).rejects.toThrow();
    await expect(siteAssets.loadConfirmComponent()).rejects.toThrow();
    expect(importer).not.toHaveBeenCalled();
  });

  it('reads the list again after it could not be read', async () => {
    const pageWindow = {
      fetch: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(serviceWorkerSource) }),
      location: { origin: 'https://senkuro.me' } as Location,
    };
    const siteAssets = createSiteAssets(pageWindow, () => Promise.resolve({ default: COMPONENT }));
    expect(await siteAssets.findCoinUrl()).toBeNull();
    expect(await siteAssets.findCoinUrl()).toBe(COIN_URL);
  });

  it('reads the list again after the site answered with an error status', async () => {
    const pageWindow = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('precache([])') })
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(serviceWorkerSource) }),
      location: { origin: 'https://senkuro.me' } as Location,
    };
    const siteAssets = createSiteAssets(pageWindow, () => Promise.resolve({ default: COMPONENT }));
    expect(await siteAssets.findCoinUrl()).toBeNull();
    expect(await siteAssets.findCoinUrl()).toBe(COIN_URL);
    expect(pageWindow.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails when the chunk has no component', async () => {
    const siteAssets = createSiteAssets(createPageWindow(serviceWorkerSource), () => Promise.resolve({}));
    await expect(siteAssets.loadConfirmComponent()).rejects.toThrow();
  });

  it('fails when the chunk cannot be imported, and tries again next time', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValue({ default: COMPONENT });
    const siteAssets = createSiteAssets(createPageWindow(serviceWorkerSource), importer);
    await expect(siteAssets.loadConfirmComponent()).rejects.toThrow('404');
    expect(await siteAssets.loadConfirmComponent()).toBe(COMPONENT);
  });
});
