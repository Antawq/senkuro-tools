import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';
import { REFRESH_BUTTON_ID, refreshButtonMissing, syncRefreshButton, type RefreshDeps } from '../utils/profile/inventory-refresh';

const BAR =
  '<header class="back"><a href="/users/phaivroh" class="router-link-active"></a><h2 class="caption">Все карточки</h2><div class="back-actions"><div class="user-card__filters"><button id="direction" class="button button--secondary button--icon"></button><div class="v-popper"></div></div></div></header>';

const open = (path: string, bar = true) => {
  window.history.pushState({}, '', path);
  document.body.innerHTML = bar ? BAR : '<div class="client-body"></div>';
};

const mounted = (on: boolean) =>
  on ? document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '') : document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);

const button = () => document.getElementById(REFRESH_BUTTON_ID) as HTMLButtonElement | null;
const bar = () => document.querySelector('.user-card__filters') as HTMLElement;
const title = () => document.querySelector('h2') as HTMLElement;

interface Rig {
  deps: RefreshDeps;
  order: string[];
  finishForgetting: () => void;
  failForgetting: (error: unknown) => void;
}

const rig = (): Rig => {
  const order: string[] = [];
  let finish: () => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const deps: RefreshDeps = {
    forget: vi.fn((slug: string) => {
      order.push(`forget ${slug}`);
      return new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    }),
    reload: vi.fn(() => void order.push('reload')),
  };
  return { deps, order, finishForgetting: () => finish(), failForgetting: (error) => fail(error) };
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
    syncRefreshButton(rig().deps);
    const added = button();
    expect(added).not.toBeNull();
    expect(title().nextElementSibling).toBe(added);
    expect(bar().children).toHaveLength(2);
    expect(added?.className).toBe('button button--secondary button--icon button-size--md');
    expect(added?.type).toBe('button');
    expect(added?.getAttribute('aria-label')).toBe('Обновить инвентарь');
    expect(added?.title).toBe('Обновить инвентарь');
    expect(added?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(added?.dataset.slug).toBe('phaivroh');
  });

  it('is there once however often the page is looked at', () => {
    open('/users/phaivroh/cards');
    const { deps } = rig();
    syncRefreshButton(deps);
    const first = button();
    syncRefreshButton(deps);
    syncRefreshButton(deps);
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
    expect(button()).toBe(first);
  });

  it('is not on any other page, and goes when the page is left', () => {
    const { deps } = rig();
    for (const path of ['/users/phaivroh', '/users/phaivroh/card-trades', '/cards/soran-f', '/users/phaivroh/cards/extra', '/']) {
      open(path);
      syncRefreshButton(deps);
      expect(button()).toBeNull();
    }
    open('/users/phaivroh/cards');
    syncRefreshButton(deps);
    expect(button()).not.toBeNull();
    window.history.pushState({}, '', '/users/phaivroh');
    syncRefreshButton(deps);
    expect(button()).toBeNull();
  });

  it('is not made while the bar is not there, and goes with the bar', () => {
    open('/users/phaivroh/cards', false);
    const { deps } = rig();
    syncRefreshButton(deps);
    expect(button()).toBeNull();
    document.body.innerHTML = BAR;
    syncRefreshButton(deps);
    expect(button()).not.toBeNull();
    bar().remove();
    syncRefreshButton(deps);
    expect(button()).toBeNull();
  });

  it('is made again for the profile the page switched to', () => {
    open('/users/phaivroh/cards');
    const { deps } = rig();
    syncRefreshButton(deps);
    window.history.pushState({}, '', '/users/chu/cards');
    syncRefreshButton(deps);
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
    expect(button()?.dataset.slug).toBe('chu');
  });

  it('is made again in the bar the site drew after it', () => {
    open('/users/phaivroh/cards');
    const { deps } = rig();
    syncRefreshButton(deps);
    document.body.innerHTML = BAR;
    syncRefreshButton(deps);
    expect(title().nextElementSibling).toBe(button());
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
  });

  it('goes at the end of the header when the site has no title there', () => {
    open('/users/phaivroh/cards');
    title().remove();
    syncRefreshButton(rig().deps);
    expect(document.querySelector('header')?.lastElementChild).toBe(button());
  });

  it('goes after the title of its own header, not after any other title on the page', () => {
    open('/users/phaivroh/cards');
    document.body.insertAdjacentHTML('afterbegin', '<section><h2 id="other">Другое</h2></section>');
    syncRefreshButton(rig().deps);
    expect(document.getElementById('other')?.nextElementSibling).toBeNull();
    expect(document.querySelector('header h2')?.nextElementSibling).toBe(button());
  });

  it('is not made for a bar outside the header of the cards page', () => {
    open('/users/phaivroh/cards', false);
    document.body.innerHTML = '<div class="user-card__filters"></div>';
    syncRefreshButton(rig().deps);
    expect(button()).toBeNull();
    expect(refreshButtonMissing()).toBe(false);
  });

  it('is there for the cards address with a closing slash too', () => {
    open('/users/phaivroh/cards/');
    syncRefreshButton(rig().deps);
    expect(button()?.dataset.slug).toBe('phaivroh');
  });

  it('reads the profile name out of a link that is encoded', () => {
    open('/users/%D1%87%D1%83/cards');
    syncRefreshButton(rig().deps);
    expect(button()?.dataset.slug).toBe('чу');
  });
});

describe('before the page has been taken over by the app', () => {
  it('puts nothing into the page, and does not call for it, until the app is mounted', () => {
    open('/users/phaivroh/cards');
    mounted(false);
    const { deps } = rig();
    syncRefreshButton(deps);
    expect(button()).toBeNull();
    expect(bar().children).toHaveLength(2);
    expect(refreshButtonMissing()).toBe(false);
    mounted(true);
    expect(refreshButtonMissing()).toBe(true);
    syncRefreshButton(deps);
    expect(title().nextElementSibling).toBe(button());
  });

  it('still takes its button away when the page is left before the app is mounted', () => {
    open('/users/phaivroh/cards');
    const { deps } = rig();
    syncRefreshButton(deps);
    mounted(false);
    window.history.pushState({}, '', '/users/phaivroh');
    syncRefreshButton(deps);
    expect(button()).toBeNull();
  });
});

describe('refreshButtonMissing', () => {
  it('says so only on the cards page with its bar and no button', () => {
    open('/users/phaivroh/cards');
    expect(refreshButtonMissing()).toBe(true);
    syncRefreshButton(rig().deps);
    expect(refreshButtonMissing()).toBe(false);
    open('/users/phaivroh');
    expect(refreshButtonMissing()).toBe(false);
    open('/users/phaivroh/cards', false);
    expect(refreshButtonMissing()).toBe(false);
  });
});

describe('pressing it', () => {
  it('disables the button at once, forgets what the extension stored for that profile, and only then reloads', async () => {
    open('/users/phaivroh/cards');
    const { deps, order, finishForgetting } = rig();
    syncRefreshButton(deps);
    button()?.click();
    expect(button()?.disabled).toBe(true);
    expect(order).toEqual(['forget phaivroh']);
    await settle();
    expect(deps.reload).not.toHaveBeenCalled();
    finishForgetting();
    await settle();
    expect(order).toEqual(['forget phaivroh', 'reload']);
  });

  it('runs once however many times it is pressed', async () => {
    open('/users/phaivroh/cards');
    const { deps, finishForgetting } = rig();
    syncRefreshButton(deps);
    const pressed = button();
    pressed?.click();
    pressed?.click();
    pressed?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    finishForgetting();
    await settle();
    expect(deps.forget).toHaveBeenCalledTimes(1);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it('stays busy through the sync that the page makes while it works', async () => {
    open('/users/phaivroh/cards');
    const { deps, finishForgetting } = rig();
    syncRefreshButton(deps);
    button()?.click();
    syncRefreshButton(deps);
    expect(button()?.disabled).toBe(true);
    finishForgetting();
    await settle();
  });

  it('reloads anyway, and says why it could not forget, when the store fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open('/users/phaivroh/cards');
    const { deps, order, failForgetting } = rig();
    syncRefreshButton(deps);
    button()?.click();
    failForgetting(new Error('storage gone'));
    await settle();
    expect(order).toEqual(['forget phaivroh', 'reload']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps the profile it was made for when the address changes before the click lands', async () => {
    open('/users/phaivroh/cards');
    const { deps, finishForgetting } = rig();
    syncRefreshButton(deps);
    const pressed = button();
    window.history.pushState({}, '', '/users/chu/cards');
    pressed?.click();
    expect(deps.forget).toHaveBeenCalledWith('phaivroh');
    finishForgetting();
    await settle();
  });
});
