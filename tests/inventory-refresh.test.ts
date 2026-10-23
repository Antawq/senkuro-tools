import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';
import { REFRESH_BUTTON_ID, isRefreshButtonMissing, syncRefreshButton, type RefreshHost } from '../utils/profile/inventory-refresh';

const CARDS_HEADER_HTML =
  '<header class="back"><a href="/users/phaivroh" class="router-link-active"></a><h2 class="caption">Все карточки</h2><div class="back-actions"><div class="user-card__filters"><button id="direction" class="button button--secondary button--icon"></button><div class="v-popper"></div></div></div></header>';

const open = (path: string, bar = true) => {
  window.history.pushState({}, '', path);
  document.body.innerHTML = bar ? CARDS_HEADER_HTML : '<div class="client-body"></div>';
};

const mounted = (on: boolean) =>
  on ? document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '') : document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);

const findRefreshButton = () => document.getElementById(REFRESH_BUTTON_ID) as HTMLButtonElement | null;
const findFilterBar = () => document.querySelector('.user-card__filters') as HTMLElement;
const findCardsTitle = () => document.querySelector('h2') as HTMLElement;

interface Rig {
  host: RefreshHost;
  order: string[];
  finishForgetting: () => void;
  failForgetting: (error: unknown) => void;
}

const rig = (): Rig => {
  const order: string[] = [];
  let finish: () => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const host: RefreshHost = {
    forget: vi.fn((slug: string) => {
      order.push(`forget ${slug}`);
      return new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    }),
    reload: vi.fn(() => void order.push('reload')),
  };
  return { host, order, finishForgetting: () => finish(), failForgetting: (error) => fail(error) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  mounted(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the button', () => {
  it('is put right after the title of the cards page, built from the site button classes and named for readers', () => {
    open('/users/phaivroh/cards');
    syncRefreshButton(rig().host);
    const added = findRefreshButton();
    expect(added).not.toBeNull();
    expect(findCardsTitle().nextElementSibling).toBe(added);
    expect(findFilterBar().children).toHaveLength(2);
    expect(added?.className).toBe('button button--secondary button--icon button-size--md');
    expect(added?.type).toBe('button');
    expect(added?.getAttribute('aria-label')).toBe('Обновить инвентарь');
    expect(added?.title).toBe('Обновить инвентарь');
    expect(added?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(added?.dataset.slug).toBe('phaivroh');
  });

  it('is there once however often the page is looked at', () => {
    open('/users/phaivroh/cards');
    const { host } = rig();
    syncRefreshButton(host);
    const first = findRefreshButton();
    syncRefreshButton(host);
    syncRefreshButton(host);
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
    expect(findRefreshButton()).toBe(first);
  });

  it('is not on any other page, and goes when the page is left', () => {
    const { host } = rig();
    for (const path of ['/users/phaivroh', '/users/phaivroh/card-trades', '/cards/soran-f', '/users/phaivroh/cards/extra', '/']) {
      open(path);
      syncRefreshButton(host);
      expect(findRefreshButton()).toBeNull();
    }
    open('/users/phaivroh/cards');
    syncRefreshButton(host);
    expect(findRefreshButton()).not.toBeNull();
    window.history.pushState({}, '', '/users/phaivroh');
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
  });

  it('is not made while the bar is not there, and goes with the bar', () => {
    open('/users/phaivroh/cards', false);
    const { host } = rig();
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
    document.body.innerHTML = CARDS_HEADER_HTML;
    syncRefreshButton(host);
    expect(findRefreshButton()).not.toBeNull();
    findFilterBar().remove();
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
  });

  it('is made again for the profile the page switched to', () => {
    open('/users/phaivroh/cards');
    const { host } = rig();
    syncRefreshButton(host);
    window.history.pushState({}, '', '/users/chu/cards');
    syncRefreshButton(host);
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
    expect(findRefreshButton()?.dataset.slug).toBe('chu');
  });

  it('is made again in the bar the site drew after it', () => {
    open('/users/phaivroh/cards');
    const { host } = rig();
    syncRefreshButton(host);
    document.body.innerHTML = CARDS_HEADER_HTML;
    syncRefreshButton(host);
    expect(findCardsTitle().nextElementSibling).toBe(findRefreshButton());
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
  });

  it('is not made when the site has no title in the header, and is not asked for', () => {
    open('/users/phaivroh/cards');
    findCardsTitle().remove();
    syncRefreshButton(rig().host);
    expect(findRefreshButton()).toBeNull();
    expect(isRefreshButtonMissing()).toBe(false);
  });

  it('goes after the title of its own header, not after any other title on the page', () => {
    open('/users/phaivroh/cards');
    document.body.insertAdjacentHTML('afterbegin', '<section><h2 id="other">Другое</h2></section>');
    syncRefreshButton(rig().host);
    expect(document.getElementById('other')?.nextElementSibling).toBeNull();
    expect(document.querySelector('header h2')?.nextElementSibling).toBe(findRefreshButton());
  });

  it('is not made for a bar outside the header of the cards page', () => {
    open('/users/phaivroh/cards', false);
    document.body.innerHTML = '<div class="user-card__filters"></div>';
    syncRefreshButton(rig().host);
    expect(findRefreshButton()).toBeNull();
    expect(isRefreshButtonMissing()).toBe(false);
  });

  it('is there for the cards address with a closing slash too', () => {
    open('/users/phaivroh/cards/');
    syncRefreshButton(rig().host);
    expect(findRefreshButton()?.dataset.slug).toBe('phaivroh');
  });

  it('reads the profile name out of a link that is encoded', () => {
    open('/users/%D1%87%D1%83/cards');
    syncRefreshButton(rig().host);
    expect(findRefreshButton()?.dataset.slug).toBe('чу');
  });
});

describe('before the page has been taken over by the app', () => {
  it('puts nothing into the page, and does not call for it, until the app is mounted', () => {
    open('/users/phaivroh/cards');
    mounted(false);
    const { host } = rig();
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
    expect(findFilterBar().children).toHaveLength(2);
    expect(isRefreshButtonMissing()).toBe(false);
    mounted(true);
    expect(isRefreshButtonMissing()).toBe(true);
    syncRefreshButton(host);
    expect(findCardsTitle().nextElementSibling).toBe(findRefreshButton());
  });

  it('still takes its button away when the page is left before the app is mounted', () => {
    open('/users/phaivroh/cards');
    const { host } = rig();
    syncRefreshButton(host);
    mounted(false);
    window.history.pushState({}, '', '/users/phaivroh');
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
  });
});

describe('isRefreshButtonMissing', () => {
  it('says so only on the cards page with its bar and no button', () => {
    open('/users/phaivroh/cards');
    expect(isRefreshButtonMissing()).toBe(true);
    syncRefreshButton(rig().host);
    expect(isRefreshButtonMissing()).toBe(false);
    open('/users/phaivroh');
    expect(isRefreshButtonMissing()).toBe(false);
    open('/users/phaivroh/cards', false);
    expect(isRefreshButtonMissing()).toBe(false);
  });
});

describe('pressing it', () => {
  it('disables the button at once, forgets what the extension stored for that profile, and only then reloads', async () => {
    open('/users/phaivroh/cards');
    const { host, order, finishForgetting } = rig();
    syncRefreshButton(host);
    findRefreshButton()?.click();
    expect(findRefreshButton()?.disabled).toBe(true);
    expect(order).toEqual(['forget phaivroh']);
    await settle();
    expect(host.reload).not.toHaveBeenCalled();
    finishForgetting();
    await settle();
    expect(order).toEqual(['forget phaivroh', 'reload']);
  });

  it('runs once however many times it is pressed', async () => {
    open('/users/phaivroh/cards');
    const { host, finishForgetting } = rig();
    syncRefreshButton(host);
    const pressed = findRefreshButton();
    pressed?.click();
    pressed?.click();
    pressed?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    finishForgetting();
    await settle();
    expect(host.forget).toHaveBeenCalledTimes(1);
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('stays busy through the sync that the page makes while it works', async () => {
    open('/users/phaivroh/cards');
    const { host, finishForgetting } = rig();
    syncRefreshButton(host);
    findRefreshButton()?.click();
    syncRefreshButton(host);
    expect(findRefreshButton()?.disabled).toBe(true);
    finishForgetting();
    await settle();
  });

  it('reloads anyway, and says why it could not forget, when the store fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open('/users/phaivroh/cards');
    const { host, order, failForgetting } = rig();
    syncRefreshButton(host);
    findRefreshButton()?.click();
    failForgetting(new Error('storage gone'));
    await settle();
    expect(order).toEqual(['forget phaivroh', 'reload']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps the profile it was made for when the address changes before the click lands', async () => {
    open('/users/phaivroh/cards');
    const { host, finishForgetting } = rig();
    syncRefreshButton(host);
    const pressed = findRefreshButton();
    window.history.pushState({}, '', '/users/chu/cards');
    pressed?.click();
    expect(host.forget).toHaveBeenCalledWith('phaivroh');
    finishForgetting();
    await settle();
  });
});
