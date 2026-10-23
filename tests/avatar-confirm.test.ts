import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AVATAR_COST_SENKOINS,
  COIN_ALT,
  COIN_CLASS,
  MONEY_STICKER_ID,
  createConfirmProps,
  createSiteAssets,
  findModals,
  installAvatarConfirm,
  type ModalEntry,
  type SiteAssets,
  type SiteModals,
} from '../utils/avatar/avatar-confirm';

const section = `
  <div class="edit-media"><div class="edit-media__banner"></div><div class="edit-media__actions"><button id="banner">Баннер</button></div></div>
  <div class="edit-media">
    <div class="edit-media__user"></div>
    <div class="edit-media__actions"><button id="upload"><span>Заменить</span></button><button id="remove">Снять</button></div>
  </div>`;

const COIN_URL = 'https://senkuro.me/assets/money-3d-D_1Eg9LH.png';
const COMPONENT = { name: 'BaseConfirmModal' };

const upload = () => document.getElementById('upload') as HTMLElement;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const costs = () => [...document.querySelectorAll('.modal-alert__desc span')];

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

interface Shown {
  loaded: unknown;
  props: { description: { type: string; text: string }[] };
  options: object;
}

let siteClicks: string[];
let answer: ReturnType<typeof deferred<boolean>>;
let closed: ReturnType<typeof deferred<boolean>>;
let shown: Shown[];
let waitedFor: string[];
let modals: SiteModals | null;
let assets: SiteAssets;
let dispose: () => void;

const siteHandler = (event: Event) => siteClicks.push((event.target as Element).closest('button')?.id ?? '');

const mountWindow = (mark: string) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="modal-alert"><div class="modal-alert__desc">С вашего баланса спишется <span>${mark}</span>. Продолжить?</div></div>`
  );
};

beforeEach(() => {
  document.body.innerHTML = section;
  siteClicks = [];
  shown = [];
  waitedFor = [];
  answer = deferred<boolean>();
  closed = deferred<boolean>();
  modals = {
    showModal: (loader, props, options) => {
      void loader().then((loaded) => shown.push({ loaded, props: props as Shown['props'], options }));
      queueMicrotask(() => mountWindow((props as Shown['props']).description[1]?.text ?? ''));
      const entry: ModalEntry = {
        emitted: (event) => {
          waitedFor.push(event);
          return event === 'confirm' ? answer.promise : closed.promise;
        },
      };
      return entry;
    },
  };
  assets = { loadConfirmComponent: () => Promise.resolve(COMPONENT), findCoinUrl: () => Promise.resolve(COIN_URL) };
  document.addEventListener('click', siteHandler);
  dispose = installAvatarConfirm({
    pageDocument: document,
    modals: () => modals,
    assets: { loadConfirmComponent: () => assets.loadConfirmComponent(), findCoinUrl: () => assets.findCoinUrl() },
  });
});

afterEach(async () => {
  answer.resolve(false);
  await flush();
  dispose();
  document.removeEventListener('click', siteHandler);
  document.body.innerHTML = '';
});

describe('the warning before an avatar upload', () => {
  it('holds the click and shows the confirm window of the site instead', async () => {
    upload().click();
    await flush();
    expect(siteClicks).toEqual([]);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.loaded).toBe(COMPONENT);
  });

  it('waits for the confirmation and for the window being closed', async () => {
    upload().click();
    await flush();
    expect(waitedFor).toEqual(['confirm', 'close']);
  });

  it('shows the money sticker and says the price, with the amount marked as the site marks its own', async () => {
    upload().click();
    await flush();
    expect(MONEY_STICKER_ID).toBe(25);
    expect(AVATAR_COST_SENKOINS).toBe(5000);
    expect(shown[0]?.props).toEqual(createConfirmProps(true));
    expect(createConfirmProps(true).sticker).toBe(MONEY_STICKER_ID);
    expect(createConfirmProps(true).title).toBe('Платная загрузка аватарки');
    expect(createConfirmProps(true).description).toEqual([
      { type: 'text', text: 'С вашего баланса спишется ' },
      { type: 'mark', text: String(AVATAR_COST_SENKOINS) },
      { type: 'text', text: '. Продолжить?' },
    ]);
  });

  it('lets the upload go on once it is confirmed', async () => {
    upload().click();
    await flush();
    answer.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('stops the upload when the window is cancelled or closed', async () => {
    upload().click();
    await flush();
    answer.resolve(false);
    await flush();
    expect(siteClicks).toEqual([]);
  });

  it('stops the upload at once when the window says it is closing, before its fade has finished', async () => {
    upload().click();
    await flush();
    closed.resolve(true);
    await flush();
    expect(siteClicks).toEqual([]);
    answer = deferred<boolean>();
    closed = deferred<boolean>();
    upload().click();
    await flush();
    expect(shown).toHaveLength(2);
  });

  it('goes on when the window reports the confirmation first and its closing right after', async () => {
    upload().click();
    await flush();
    answer.resolve(true);
    closed.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('asks again on the next click', async () => {
    upload().click();
    await flush();
    answer.resolve(false);
    await flush();
    answer = deferred<boolean>();
    upload().click();
    await flush();
    expect(shown).toHaveLength(2);
    answer.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('shows one window however often the button is pressed meanwhile, and goes on once', async () => {
    upload().click();
    upload().click();
    upload().click();
    await flush();
    expect(shown).toHaveLength(1);
    answer.resolve(true);
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('holds a click on what is inside the button too', async () => {
    (upload().querySelector('span') as HTMLElement).click();
    await flush();
    expect(siteClicks).toEqual([]);
    expect(shown).toHaveLength(1);
  });

  it('is only the avatar button, not the button beside it nor the banner', async () => {
    document.getElementById('remove')?.click();
    document.getElementById('banner')?.click();
    await flush();
    expect(siteClicks).toEqual(['remove', 'banner']);
    expect(shown).toHaveLength(0);
  });

  it('stops asking once it is switched off', async () => {
    dispose();
    upload().click();
    await flush();
    expect(siteClicks).toEqual(['upload']);
    expect(shown).toHaveLength(0);
  });
});

describe('the 3D coin in place of the word', () => {
  it('puts the coin of the site after the amount, with the word as its alternative text', async () => {
    upload().click();
    await flush();
    const coin = costs()[0]?.querySelector('img');
    expect(costs()[0]?.textContent).toBe(String(AVATAR_COST_SENKOINS));
    expect(coin?.getAttribute('src')).toBe(COIN_URL);
    expect(coin?.getAttribute('alt')).toBe(COIN_ALT);
  });

  it('leaves the size of the coin to the stylesheet of the extension', async () => {
    upload().click();
    await flush();
    const coin = costs()[0]?.querySelector('img');
    expect(coin?.className).toBe(COIN_CLASS);
    expect(coin?.getAttribute('style')).toBeNull();
  });

  it('puts one coin however often the window changes', async () => {
    upload().click();
    await flush();
    document.querySelector('.modal-alert')?.insertAdjacentHTML('beforeend', '<i></i>');
    await flush();
    expect(costs()[0]?.querySelectorAll('img')).toHaveLength(1);
  });

  it('leaves other windows alone, such as the confirmation of age', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="modal-alert"><div class="modal-alert__desc">для <span>взрослых</span> и <span>5000</span> и <span>15000 штук</span></div></div>'
    );
    document.body.insertAdjacentHTML('beforeend', '<div class="elsewhere"><span>5000</span></div>');
    upload().click();
    await flush();
    const spans = [...document.querySelectorAll('span')].filter((span) => span.querySelector('img'));
    expect(spans).toHaveLength(2);
    expect(document.querySelector('.elsewhere span')?.querySelector('img')).toBeNull();
    expect(
      costs()
        .find((span) => span.textContent === 'взрослых')
        ?.querySelector('img')
    ).toBeNull();
    expect(
      costs()
        .find((span) => span.textContent === '15000 штук')
        ?.querySelector('img')
    ).toBeNull();
  });

  it('says the word instead when the coin cannot be found, and puts no picture', async () => {
    assets = { loadConfirmComponent: () => Promise.resolve(COMPONENT), findCoinUrl: () => Promise.resolve(null) };
    upload().click();
    await flush();
    expect(shown[0]?.props).toEqual(createConfirmProps(false));
    expect(createConfirmProps(false).description[1]?.text).toBe(`${AVATAR_COST_SENKOINS} ${COIN_ALT}`);
    expect(costs()[0]?.textContent).toBe(`${AVATAR_COST_SENKOINS} ${COIN_ALT}`);
    expect(document.querySelector('img')).toBeNull();
  });

  it('stops looking for the window once the question is answered', async () => {
    upload().click();
    await flush();
    answer.resolve(false);
    await flush();
    mountWindow(String(AVATAR_COST_SENKOINS));
    await flush();
    expect(costs().at(-1)?.querySelector('img')).toBeNull();
  });

  it('puts the coin in the window it asked for even when that window is slow to appear', async () => {
    modals = {
      showModal: (loader, props) => {
        void loader();
        setTimeout(() => mountWindow((props as Shown['props']).description[1]?.text ?? ''), 20);
        return { emitted: (event) => (event === 'confirm' ? answer.promise : closed.promise) };
      },
    };
    upload().click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(costs()[0]?.querySelector('img')).not.toBeNull();
  });
});

describe('when the window of the site cannot be reached, the upload is not blocked', () => {
  it('does not even hold the click when the site has no modal controller', () => {
    modals = null;
    upload().click();
    expect(siteClicks).toEqual(['upload']);
  });

  it('goes on when the window cannot be loaded', async () => {
    assets = { loadConfirmComponent: () => Promise.reject(new Error('offline')), findCoinUrl: () => Promise.resolve(COIN_URL) };
    upload().click();
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('goes on when the controller refuses to show it', async () => {
    modals = {
      showModal: () => {
        throw new Error('no container');
      },
    };
    upload().click();
    await flush();
    expect(siteClicks).toEqual(['upload']);
  });

  it('can ask again after a failure', async () => {
    assets = { loadConfirmComponent: () => Promise.reject(new Error('offline')), findCoinUrl: () => Promise.resolve(COIN_URL) };
    upload().click();
    await flush();
    assets = { loadConfirmComponent: () => Promise.resolve(COMPONENT), findCoinUrl: () => Promise.resolve(COIN_URL) };
    upload().click();
    await flush();
    expect(shown).toHaveLength(1);
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
    expect(findModals(document)).toBe(controller);
  });

  it.each([
    ['no app mounted', () => (document.body.innerHTML = '')],
    ['a page without Vue', () => (document.body.innerHTML = '<div id="app"></div>')],
    ['an app that provides nothing like it', () => appWith({ [Symbol('urql')]: {} })],
    ['a modals entry that cannot show anything', () => appWith({ [Symbol('modals')]: { queue: [] } })],
    ['a modals entry that is empty', () => appWith({ [Symbol('modals')]: null })],
  ])('finds nothing with %s', (_name, setup) => {
    setup();
    expect(findModals(document)).toBeNull();
  });
});

describe('loading the confirm window and the coin of the site', () => {
  const sw =
    'precache([{url:"assets/BaseButton-Ab12.js"},{url:"assets/BaseConfirmModal-Dw121HiH.js"},{url:"assets/money-3d-D_1Eg9LH.png"},{url:"assets/other.js"}])';
  const createPageWindow = (text: string) => ({
    fetch: vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(text) } as Response)),
    location: { origin: 'https://senkuro.me' } as Location,
  });

  it('reads the chunk of the window from the service worker list and imports it from the site', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const pageWindow = createPageWindow(sw);
    expect(await createSiteAssets(pageWindow, importer).loadConfirmComponent()).toBe(COMPONENT);
    expect(pageWindow.fetch).toHaveBeenCalledWith('/sw.js');
    expect(importer).toHaveBeenCalledWith('https://senkuro.me/assets/BaseConfirmModal-Dw121HiH.js');
  });

  it('reads the picture of the coin from the same list', async () => {
    expect(await createSiteAssets(createPageWindow(sw)).findCoinUrl()).toBe(COIN_URL);
  });

  it('reads the list once for both, however often they are asked', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const pageWindow = createPageWindow(sw);
    const loader = createSiteAssets(pageWindow, importer);
    await Promise.all([loader.loadConfirmComponent(), loader.loadConfirmComponent(), loader.findCoinUrl()]);
    await loader.loadConfirmComponent();
    await loader.findCoinUrl();
    expect(pageWindow.fetch).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('finds no coin when the list names none, or cannot be read, and never fails for it', async () => {
    expect(await createSiteAssets(createPageWindow('precache([])')).findCoinUrl()).toBeNull();
    const broken = { fetch: vi.fn(() => Promise.reject(new Error('offline'))), location: { origin: 'https://senkuro.me' } as Location };
    expect(await createSiteAssets(broken).findCoinUrl()).toBeNull();
  });

  it('fails when the list names no such chunk, and tries again next time', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const pageWindow = createPageWindow('precache([])');
    const loader = createSiteAssets(pageWindow, importer);
    await expect(loader.loadConfirmComponent()).rejects.toThrow();
    await expect(loader.loadConfirmComponent()).rejects.toThrow();
    expect(importer).not.toHaveBeenCalled();
  });

  it('reads the list again after it could not be read', async () => {
    const pageWindow = {
      fetch: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(sw) }),
      location: { origin: 'https://senkuro.me' } as Location,
    };
    const loader = createSiteAssets(pageWindow, () => Promise.resolve({ default: COMPONENT }));
    expect(await loader.findCoinUrl()).toBeNull();
    expect(await loader.findCoinUrl()).toBe(COIN_URL);
  });

  it('reads the list again after the site answered with an error status', async () => {
    const pageWindow = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('precache([])') })
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(sw) }),
      location: { origin: 'https://senkuro.me' } as Location,
    };
    const loader = createSiteAssets(pageWindow, () => Promise.resolve({ default: COMPONENT }));
    expect(await loader.findCoinUrl()).toBeNull();
    expect(await loader.findCoinUrl()).toBe(COIN_URL);
    expect(pageWindow.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails when the chunk has no component', async () => {
    const loader = createSiteAssets(createPageWindow(sw), () => Promise.resolve({}));
    await expect(loader.loadConfirmComponent()).rejects.toThrow();
  });

  it('fails when the chunk cannot be imported, and tries again next time', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValue({ default: COMPONENT });
    const loader = createSiteAssets(createPageWindow(sw), importer);
    await expect(loader.loadConfirmComponent()).rejects.toThrow('404');
    expect(await loader.loadConfirmComponent()).toBe(COMPONENT);
  });
});
