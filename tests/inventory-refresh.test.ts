import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';
import type { RefreshOutcome } from '../utils/shared/refresh-signal';
import { REFRESH_BUTTON_ID, isRefreshButtonMissing, syncRefreshButton, type RefreshHost } from '../utils/profile/inventory-refresh';

const CARDS_HEADER_HTML =
  '<header class="back"><a href="/users/phaivroh" class="router-link-active"></a><h2 class="caption">Все карточки</h2><div class="back-actions"><div class="user-card__filters"><button id="direction" class="button button--secondary button--icon"></button><div class="v-popper"></div></div></div></header>';

const openPage = (path: string, hasBar = true) => {
  window.history.pushState({}, '', path);
  document.body.innerHTML = hasBar ? CARDS_HEADER_HTML : '<div class="client-body"></div>';
};

const setAppMounted = (isMounted: boolean) =>
  isMounted ? document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '') : document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);

const findRefreshButton = () => document.getElementById(REFRESH_BUTTON_ID) as HTMLButtonElement | null;
const findFilterBar = () => document.querySelector('.user-card__filters') as HTMLElement;
const findCardsTitle = () => document.querySelector('h2') as HTMLElement;

interface Rig {
  host: RefreshHost;
  calls: string[];
  answerRefresh: (outcome: RefreshOutcome) => void;
  finishForgetting: () => void;
  failForgetting: (error: unknown) => void;
}

const createRig = ({ isReady = true }: { isReady?: boolean } = {}): Rig => {
  const calls: string[] = [];
  let answer: (outcome: RefreshOutcome) => void = () => undefined;
  let finish: () => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const host: RefreshHost = {
    isReady: () => isReady,
    refresh: vi.fn(() => {
      calls.push('refresh');
      return new Promise<RefreshOutcome>((resolve) => {
        answer = resolve;
      });
    }),
    forget: vi.fn((slug: string) => {
      calls.push(`forget ${slug}`);
      return new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    }),
    reload: vi.fn(() => void calls.push('reload')),
    redraw: vi.fn(() => void calls.push('redraw')),
  };
  return { host, calls, answerRefresh: (outcome) => answer(outcome), finishForgetting: () => finish(), failForgetting: (error) => fail(error) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  setAppMounted(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the button', () => {
  it('is put right after the title of the cards page, built from the site button classes and named for readers', () => {
    openPage('/users/phaivroh/cards');
    syncRefreshButton(createRig().host);
    const added = findRefreshButton();
    expect(added).not.toBeNull();
    expect(findCardsTitle().nextElementSibling).toBe(added);
    expect(findFilterBar().children).toHaveLength(2);
    expect(added?.className).toBe('button button--secondary button--icon button-size--md');
    expect(added?.type).toBe('button');
    expect(added?.getAttribute('aria-label')).toBe('Обновить инвентарь');
    expect(added?.title).toBe('Обновить инвентарь');
    expect(added?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(added?.dataset.senkutoolsSlug).toBe('phaivroh');
  });

  it('is there once however often the page is looked at', () => {
    openPage('/users/phaivroh/cards');
    const { host } = createRig();
    syncRefreshButton(host);
    const first = findRefreshButton();
    syncRefreshButton(host);
    syncRefreshButton(host);
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
    expect(findRefreshButton()).toBe(first);
  });

  it('is not on any other page, and goes when the page is left', () => {
    const { host } = createRig();
    for (const path of ['/users/phaivroh', '/users/phaivroh/card-trades', '/cards/soran-f', '/users/phaivroh/cards/extra', '/']) {
      openPage(path);
      syncRefreshButton(host);
      expect(findRefreshButton()).toBeNull();
    }
    openPage('/users/phaivroh/cards');
    syncRefreshButton(host);
    expect(findRefreshButton()).not.toBeNull();
    window.history.pushState({}, '', '/users/phaivroh');
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
  });

  it('is not made while the bar is not there, and goes with the bar', () => {
    openPage('/users/phaivroh/cards', false);
    const { host } = createRig();
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
    openPage('/users/phaivroh/cards');
    const { host } = createRig();
    syncRefreshButton(host);
    window.history.pushState({}, '', '/users/chu/cards');
    syncRefreshButton(host);
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
    expect(findRefreshButton()?.dataset.senkutoolsSlug).toBe('chu');
  });

  it('is made again in the bar the site drew after it', () => {
    openPage('/users/phaivroh/cards');
    const { host } = createRig();
    syncRefreshButton(host);
    document.body.innerHTML = CARDS_HEADER_HTML;
    syncRefreshButton(host);
    expect(findCardsTitle().nextElementSibling).toBe(findRefreshButton());
    expect(document.querySelectorAll(`#${REFRESH_BUTTON_ID}`)).toHaveLength(1);
  });

  it('is not made when the site has no title in the header, and is not asked for', () => {
    openPage('/users/phaivroh/cards');
    findCardsTitle().remove();
    syncRefreshButton(createRig().host);
    expect(findRefreshButton()).toBeNull();
    expect(isRefreshButtonMissing()).toBe(false);
  });

  it('goes after the title of its own header, not after any other title on the page', () => {
    openPage('/users/phaivroh/cards');
    document.body.insertAdjacentHTML('afterbegin', '<section><h2 id="other">Другое</h2></section>');
    syncRefreshButton(createRig().host);
    expect(document.getElementById('other')?.nextElementSibling).toBeNull();
    expect(document.querySelector('header h2')?.nextElementSibling).toBe(findRefreshButton());
  });

  it('is not made for a bar outside the header of the cards page', () => {
    openPage('/users/phaivroh/cards', false);
    document.body.innerHTML = '<div class="user-card__filters"></div>';
    syncRefreshButton(createRig().host);
    expect(findRefreshButton()).toBeNull();
    expect(isRefreshButtonMissing()).toBe(false);
  });

  it('is there for the cards address with a closing slash too', () => {
    openPage('/users/phaivroh/cards/');
    syncRefreshButton(createRig().host);
    expect(findRefreshButton()?.dataset.senkutoolsSlug).toBe('phaivroh');
  });

  it('reads the profile name out of a link that is encoded', () => {
    openPage('/users/%D1%87%D1%83/cards');
    syncRefreshButton(createRig().host);
    expect(findRefreshButton()?.dataset.senkutoolsSlug).toBe('чу');
  });
});

describe('before the page has been taken over by the app', () => {
  it('puts nothing into the page, and does not call for it, until the app is mounted', () => {
    openPage('/users/phaivroh/cards');
    setAppMounted(false);
    const { host } = createRig();
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
    expect(findFilterBar().children).toHaveLength(2);
    expect(isRefreshButtonMissing()).toBe(false);
    setAppMounted(true);
    expect(isRefreshButtonMissing()).toBe(true);
    syncRefreshButton(host);
    expect(findCardsTitle().nextElementSibling).toBe(findRefreshButton());
  });

  it('still takes its button away when the page is left before the app is mounted', () => {
    openPage('/users/phaivroh/cards');
    const { host } = createRig();
    syncRefreshButton(host);
    setAppMounted(false);
    window.history.pushState({}, '', '/users/phaivroh');
    syncRefreshButton(host);
    expect(findRefreshButton()).toBeNull();
  });
});

describe('isRefreshButtonMissing', () => {
  it('says so only on the cards page with its bar and no button', () => {
    openPage('/users/phaivroh/cards');
    expect(isRefreshButtonMissing()).toBe(true);
    syncRefreshButton(createRig().host);
    expect(isRefreshButtonMissing()).toBe(false);
    openPage('/users/phaivroh');
    expect(isRefreshButtonMissing()).toBe(false);
    openPage('/users/phaivroh/cards', false);
    expect(isRefreshButtonMissing()).toBe(false);
  });
});

describe('pressing it', () => {
  const press = () => {
    openPage('/users/phaivroh/cards');
    const rig = createRig();
    syncRefreshButton(rig.host);
    findRefreshButton()?.click();
    return rig;
  };

  it('asks the page to refresh its lists in place and keeps the button busy until the page has answered', async () => {
    const { host, calls, answerRefresh } = press();
    expect(findRefreshButton()?.disabled).toBe(true);
    expect(findRefreshButton()?.getAttribute('aria-busy')).toBe('true');
    expect(calls).toEqual(['refresh']);
    await settle();
    expect(host.forget).not.toHaveBeenCalled();
    answerRefresh('done');
    await settle();
    expect(calls).toEqual(['refresh', 'forget phaivroh']);
  });

  it('forgets what the extension stored for that profile, redraws the chip and gives the button back, without reloading', async () => {
    const { host, calls, answerRefresh, finishForgetting } = press();
    answerRefresh('done');
    await settle();
    finishForgetting();
    await settle();
    expect(calls).toEqual(['refresh', 'forget phaivroh', 'redraw']);
    expect(host.reload).not.toHaveBeenCalled();
    expect(findRefreshButton()?.disabled).toBe(false);
    expect(findRefreshButton()?.hasAttribute('aria-busy')).toBe(false);
  });

  it('reloads the page instead when the page has no list of the profile to refresh', async () => {
    const { host, calls, answerRefresh, finishForgetting } = press();
    answerRefresh('nothing');
    await settle();
    expect(host.reload).not.toHaveBeenCalled();
    finishForgetting();
    await settle();
    expect(calls).toEqual(['refresh', 'forget phaivroh', 'reload']);
    expect(findRefreshButton()?.disabled).toBe(true);
  });

  it('reloads without asking when the page guard is not ready', async () => {
    openPage('/users/phaivroh/cards');
    const { host, calls, finishForgetting } = createRig({ isReady: false });
    syncRefreshButton(host);
    findRefreshButton()?.click();
    expect(calls).toEqual(['forget phaivroh']);
    await settle();
    expect(host.reload).not.toHaveBeenCalled();
    finishForgetting();
    await settle();
    expect(calls).toEqual(['forget phaivroh', 'reload']);
    expect(host.refresh).not.toHaveBeenCalled();
  });

  it('only gives the button back when the refresh failed, so the chip keeps what it had', async () => {
    const { host, answerRefresh } = press();
    answerRefresh('failed');
    await settle();
    expect(host.forget).not.toHaveBeenCalled();
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.redraw).not.toHaveBeenCalled();
    expect(findRefreshButton()?.disabled).toBe(false);
  });

  it('runs once however many times it is pressed', async () => {
    const { host, answerRefresh, finishForgetting } = press();
    const pressed = findRefreshButton();
    pressed?.click();
    pressed?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    answerRefresh('done');
    await settle();
    finishForgetting();
    await settle();
    expect(host.refresh).toHaveBeenCalledTimes(1);
    expect(host.forget).toHaveBeenCalledTimes(1);
  });

  it('stays busy through the sync that the page makes while it works', async () => {
    const { host, answerRefresh } = press();
    syncRefreshButton(host);
    expect(findRefreshButton()?.disabled).toBe(true);
    answerRefresh('failed');
    await settle();
  });

  it('says why it could not forget when the store fails, and carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { calls, answerRefresh, failForgetting } = press();
    answerRefresh('done');
    await settle();
    failForgetting(new Error('storage gone'));
    await settle();
    expect(calls).toEqual(['refresh', 'forget phaivroh', 'redraw']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps the profile it was made for when the address changes before the click lands', async () => {
    openPage('/users/phaivroh/cards');
    const { host, answerRefresh } = createRig();
    syncRefreshButton(host);
    const pressed = findRefreshButton();
    window.history.pushState({}, '', '/users/chu/cards');
    pressed?.click();
    answerRefresh('done');
    await settle();
    expect(host.forget).toHaveBeenCalledWith('phaivroh');
  });
});
