import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AVATAR_COST,
  CONFIRM_PROPS,
  MONEY_STICKER,
  createConfirmLoader,
  findModals,
  installAvatarConfirm,
  type ModalEntry,
  type SiteModals,
} from '../utils/avatar/avatar-confirm';

const section = `
  <div class="edit-media"><div class="edit-media__banner"></div><div class="edit-media__actions"><button id="banner">Баннер</button></div></div>
  <div class="edit-media">
    <div class="edit-media__user"></div>
    <div class="edit-media__actions"><button id="upload"><span>Заменить</span></button><button id="remove">Снять</button></div>
  </div>`;

const visit = (path: string) => window.history.pushState({}, '', path);
const upload = () => document.getElementById('upload') as HTMLElement;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

let siteClicks: string[];
let answer: ReturnType<typeof deferred<boolean>>;
let closed: ReturnType<typeof deferred<boolean>>;
let shown: { loaded: unknown; props: object; options: object }[];
let waitedFor: string[];
let modals: SiteModals | null;
let component: () => Promise<unknown>;
let dispose: () => void;
const COMPONENT = { name: 'BaseConfirmModal' };

const siteHandler = (event: Event) => siteClicks.push((event.target as Element).closest('button')?.id ?? '');

beforeEach(() => {
  visit('/settings/appearance');
  document.body.innerHTML = section;
  siteClicks = [];
  shown = [];
  waitedFor = [];
  answer = deferred<boolean>();
  closed = deferred<boolean>();
  modals = {
    showModal: (loader, props, options) => {
      void loader().then((loaded) => shown.push({ loaded, props, options }));
      const entry: ModalEntry = {
        emitted: (event) => {
          waitedFor.push(event);
          return event === 'confirm' ? answer.promise : closed.promise;
        },
      };
      return entry;
    },
  };
  component = () => Promise.resolve(COMPONENT);
  document.addEventListener('click', siteHandler);
  dispose = installAvatarConfirm({ doc: document, modals: () => modals, component: () => component() });
});

afterEach(() => {
  dispose();
  document.removeEventListener('click', siteHandler);
  document.body.innerHTML = '';
  visit('/');
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
    expect(MONEY_STICKER).toBe(25);
    expect(AVATAR_COST).toBe(5000);
    expect(shown[0]?.props).toEqual(CONFIRM_PROPS);
    expect(CONFIRM_PROPS.sticker).toBe(MONEY_STICKER);
    expect(CONFIRM_PROPS.title).toBe('Платная загрузка аватарки');
    expect(CONFIRM_PROPS.description).toEqual([
      { type: 'text', text: 'С вашего баланса спишется ' },
      { type: 'mark', text: `${AVATAR_COST} сенкоинов` },
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

  it('works on the sub pages of the appearance settings, where the same section is shown', async () => {
    visit('/settings/appearance/frames');
    upload().click();
    await flush();
    expect(shown).toHaveLength(1);
  });

  it('is only the avatar button, not the button beside it nor the banner', async () => {
    document.getElementById('remove')?.click();
    document.getElementById('banner')?.click();
    await flush();
    expect(siteClicks).toEqual(['remove', 'banner']);
    expect(shown).toHaveLength(0);
  });

  it.each([['/guilds/some/edit'], ['/teams/some/edit'], ['/settings/account'], ['/settings/appearances'], ['/']])(
    'leaves the same button on %s alone, which is not the user avatar',
    async (path) => {
      visit(path);
      upload().click();
      await flush();
      expect(siteClicks).toEqual(['upload']);
      expect(shown).toHaveLength(0);
    }
  );

  it('stops asking once it is switched off', async () => {
    dispose();
    upload().click();
    await flush();
    expect(siteClicks).toEqual(['upload']);
    expect(shown).toHaveLength(0);
  });
});

describe('when the window of the site cannot be reached, the upload is not blocked', () => {
  it('does not even hold the click when the site has no modal controller', () => {
    modals = null;
    upload().click();
    expect(siteClicks).toEqual(['upload']);
  });

  it('goes on when the window cannot be loaded', async () => {
    component = () => Promise.reject(new Error('offline'));
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
    component = () => Promise.reject(new Error('offline'));
    upload().click();
    await flush();
    component = () => Promise.resolve(COMPONENT);
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

describe('loading the confirm window of the site', () => {
  const sw = 'precache([{url:"assets/BaseButton-Ab12.js"},{url:"assets/BaseConfirmModal-Dw121HiH.js"},{url:"assets/other.js"}])';
  const win = (text: string) => ({
    fetch: vi.fn(() => Promise.resolve({ text: () => Promise.resolve(text) } as Response)),
    location: { origin: 'https://senkuro.me' } as Location,
  });

  it('reads the chunk of the window from the service worker list and imports it from the site', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const host = win(sw);
    expect(await createConfirmLoader(host, importer)()).toBe(COMPONENT);
    expect(host.fetch).toHaveBeenCalledWith('/sw.js');
    expect(importer).toHaveBeenCalledWith('https://senkuro.me/assets/BaseConfirmModal-Dw121HiH.js');
  });

  it('does it once however often it is asked', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const host = win(sw);
    const load = createConfirmLoader(host, importer);
    await Promise.all([load(), load()]);
    await load();
    expect(host.fetch).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('fails when the list names no such chunk, and tries again next time', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: COMPONENT }));
    const host = win('precache([])');
    const load = createConfirmLoader(host, importer);
    await expect(load()).rejects.toThrow();
    await expect(load()).rejects.toThrow();
    expect(host.fetch).toHaveBeenCalledTimes(2);
    expect(importer).not.toHaveBeenCalled();
  });

  it('fails when the chunk has no component', async () => {
    const load = createConfirmLoader(win(sw), () => Promise.resolve({}));
    await expect(load()).rejects.toThrow();
  });

  it('fails when the chunk cannot be imported, and tries again next time', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValue({ default: COMPONENT });
    const load = createConfirmLoader(win(sw), importer);
    await expect(load()).rejects.toThrow('404');
    expect(await load()).toBe(COMPONENT);
  });
});
