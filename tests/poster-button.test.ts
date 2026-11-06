import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';
import type { SelectedCard } from '../utils/poster/poster-cards';
import { POSTER_BUTTON_TEXT, POSTER_CONTROL_CLASS, isPosterButtonMissing, syncPosterButton, type PosterButtonHost } from '../utils/poster/poster-button';

const FRONT = '<div class="card-collect__front"><img class="card-collect__img" alt="Card"></div>';

const rowOf = (slug: string, { isSelected = false, isShard = false } = {}): string => {
  const classes = ['card-collect-preview', 'user-card', isSelected ? 'user-card--selected' : '', isShard ? 'card-collect-preview--shard' : '']
    .filter(Boolean)
    .join(' ');
  return `<div class="${classes}"><div class="card-collect-preview__status"></div><div class="card-collect-preview__flip-container"><div class="card-collect-preview__front"><a class="card-collect" href="/cards/${slug}">${FRONT}</a></div></div></div>`;
};

const pageOf = (rows: string, hasSelectionMenu = true): string =>
  `<header class="back"><h2>Все карточки</h2><div class="back-actions"><div class="user-card__filters"><button id="direction" class="button"></button><div class="v-popper">${
    hasSelectionMenu ? '<button aria-label="more options"></button>' : ''
  }</div></div></div></header><div class="user-cards-grid">${rows}</div>`;

const setMounted = (isMounted: boolean): void => {
  if (isMounted) document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
  else document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);
};

const openPage = (path: string, rows: string, hasSelectionMenu = true): void => {
  window.history.pushState({}, '', path);
  document.body.innerHTML = pageOf(rows, hasSelectionMenu);
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const controls = (): NodeListOf<HTMLElement> => document.querySelectorAll<HTMLElement>(`.${POSTER_CONTROL_CLASS}`);
const trigger = (): HTMLButtonElement => {
  const button = document.querySelector<HTMLButtonElement>('.senkutools-poster__trigger');
  if (!button) throw new Error('no trigger');
  return button;
};
const panel = (): HTMLElement => document.querySelector<HTMLElement>('.senkutools-poster__panel') as HTMLElement;
const hint = (): string => document.querySelector('.senkutools-poster__hint')?.textContent ?? '';
const rowElements = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.user-cards-grid > .card-collect-preview')];

const hostOf = () => {
  const openDialog = vi.fn<(cards: readonly SelectedCard[], profileSlug: string) => void>();
  const host: PosterButtonHost = { openDialog };
  return { host, openDialog };
};

let rig = hostOf();

beforeEach(() => {
  rig = hostOf();
  setMounted(true);
});

afterEach(() => {
  document.body.innerHTML = '';
  syncPosterButton(document, rig.host);
  setMounted(false);
  window.history.pushState({}, '', '/');
});

describe('syncPosterButton', () => {
  it('draws one button in the filter bar of the own cards page, after the site controls, and not twice', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    syncPosterButton(document, rig.host);
    const bar = document.querySelector('.user-card__filters') as HTMLElement;
    expect(controls()).toHaveLength(1);
    expect(bar.lastElementChild).toBe(controls()[0]);
    expect(trigger().className).toBe('button button--secondary button--icon button-size--md senkutools-poster__trigger');
    expect(trigger().getAttribute('aria-label')).toBe(POSTER_BUTTON_TEXT.label);
    expect(trigger().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the same button on every later sync', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    const first = trigger();
    syncPosterButton(document, rig.host);
    expect(trigger()).toBe(first);
  });

  it('moves the button when another filter bar becomes the first one', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    const oldBar = document.querySelector('.user-card__filters') as HTMLElement;
    const newBar = document.createElement('div');
    newBar.className = 'user-card__filters';
    newBar.innerHTML = '<button aria-label="more options"></button>';
    oldBar.before(newBar);
    syncPosterButton(document, rig.host);
    expect(oldBar.querySelector(`.${POSTER_CONTROL_CLASS}`)).toBeNull();
    expect(newBar.querySelectorAll(`.${POSTER_CONTROL_CLASS}`)).toHaveLength(1);
    expect(controls()).toHaveLength(1);
  });

  it('stays last when another own control is added to the bar later', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    const bar = document.querySelector('.user-card__filters') as HTMLElement;
    const other = document.createElement('div');
    other.className = 'senkutools-price-filter';
    bar.insertBefore(other, controls()[0] ?? null);
    syncPosterButton(document, rig.host);
    expect([...bar.children].slice(-2)).toEqual([other, controls()[0]]);
  });

  it('draws nothing where the site offers no selection menu', () => {
    openPage('/users/other/cards', rowOf('alpha-s'), false);
    syncPosterButton(document, rig.host);
    expect(controls()).toHaveLength(0);
    expect(isPosterButtonMissing(document)).toBe(false);
  });

  it('draws nothing before the app is mounted and draws it after', () => {
    setMounted(false);
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    expect(controls()).toHaveLength(0);
    setMounted(true);
    expect(isPosterButtonMissing(document)).toBe(true);
    syncPosterButton(document, rig.host);
    expect(controls()).toHaveLength(1);
    expect(isPosterButtonMissing(document)).toBe(false);
  });

  it.each(['/users/sena', '/users/sena/trades', '/cards/alpha-s', '/users/settings/cards'])('draws nothing on %s', (path) => {
    openPage(path, rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    expect(controls()).toHaveLength(0);
  });

  it('removes the button when the page leaves the cards route', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    window.history.pushState({}, '', '/users/sena');
    syncPosterButton(document, rig.host);
    expect(controls()).toHaveLength(0);
  });

  it('rebuilds the button for another profile on the same bar', () => {
    openPage('/users/sena/cards', rowOf('alpha-s', { isSelected: true }));
    syncPosterButton(document, rig.host);
    expect(controls()[0]?.dataset.senkutoolsSlug).toBe('sena');
    window.history.pushState({}, '', '/users/miha/cards');
    syncPosterButton(document, rig.host);
    expect(controls()).toHaveLength(1);
    expect(controls()[0]?.dataset.senkutoolsSlug).toBe('miha');
    trigger().click();
    expect(rig.openDialog.mock.calls[0]?.[1]).toBe('miha');
  });
});

describe('selection dot', () => {
  it('follows the selection class of the rows', async () => {
    openPage('/users/sena/cards', rowOf('alpha-s') + rowOf('beta-a'));
    syncPosterButton(document, rig.host);
    expect(trigger().classList.contains('button--chip')).toBe(false);
    rowElements()[0]?.classList.add('user-card--selected');
    await settle();
    expect(trigger().classList.contains('button--chip')).toBe(true);
    rowElements()[0]?.classList.remove('user-card--selected');
    await settle();
    expect(trigger().classList.contains('button--chip')).toBe(false);
  });

  it('follows selected rows that are added to or removed from the grid', async () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    const grid = document.querySelector('.user-cards-grid') as HTMLElement;
    grid.insertAdjacentHTML('beforeend', rowOf('beta-a', { isSelected: true }));
    await settle();
    expect(trigger().classList.contains('button--chip')).toBe(true);
    grid.lastElementChild?.remove();
    await settle();
    expect(trigger().classList.contains('button--chip')).toBe(false);
  });

  it('keeps one observer while the grid and the button stay the same', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    syncPosterButton(document, rig.host);
    syncPosterButton(document, rig.host);
    const disconnectCount = disconnect.mock.calls.length;
    disconnect.mockRestore();
    expect(disconnectCount).toBe(0);
  });

  it('shows the dot for a selection that was made before the button was drawn', () => {
    openPage('/users/sena/cards', rowOf('alpha-s', { isSelected: true }));
    syncPosterButton(document, rig.host);
    expect(trigger().classList.contains('button--chip')).toBe(true);
  });

  it('keeps following after the site replaces the grid', async () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    const oldGrid = document.querySelector('.user-cards-grid') as HTMLElement;
    const newGrid = document.createElement('div');
    newGrid.className = 'user-cards-grid';
    newGrid.innerHTML = rowOf('gamma-b');
    oldGrid.replaceWith(newGrid);
    syncPosterButton(document, rig.host);
    newGrid.children[0]?.classList.add('user-card--selected');
    await settle();
    expect(trigger().classList.contains('button--chip')).toBe(true);
    oldGrid.innerHTML = rowOf('stale-c', { isSelected: true });
    newGrid.children[0]?.classList.remove('user-card--selected');
    await settle();
    expect(trigger().classList.contains('button--chip')).toBe(false);
  });

  it('stops following when the button is removed', async () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    const button = trigger();
    const grid = document.querySelector('.user-cards-grid') as HTMLElement;
    window.history.pushState({}, '', '/users/sena');
    syncPosterButton(document, rig.host);
    grid.children[0]?.classList.add('user-card--selected');
    await settle();
    expect(button.classList.contains('button--chip')).toBe(false);
  });
});

describe('pressing the button', () => {
  it('opens the dialog with the selected cards in page order and the profile slug', () => {
    openPage('/users/sena/cards', rowOf('alpha-s', { isSelected: true }) + rowOf('skipped-a') + rowOf('beta-b', { isSelected: true }));
    syncPosterButton(document, rig.host);
    trigger().click();
    expect(rig.openDialog).toHaveBeenCalledTimes(1);
    expect(rig.openDialog.mock.calls[0]?.[0].map((card) => card.slug)).toEqual(['alpha-s', 'beta-b']);
    expect(rig.openDialog.mock.calls[0]?.[1]).toBe('sena');
    expect(panel().hidden).toBe(true);
  });

  it('explains how to select when nothing is selected, and closes the explanation on a second press', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    trigger().click();
    expect(rig.openDialog).not.toHaveBeenCalled();
    expect(panel().hidden).toBe(false);
    expect(hint()).toBe(POSTER_BUTTON_TEXT.howToSelect);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    trigger().click();
    expect(panel().hidden).toBe(true);
  });

  it('says that shards do not make a poster when only shard rows are selected', () => {
    openPage('/users/sena/cards', rowOf('shard-a', { isSelected: true, isShard: true }));
    syncPosterButton(document, rig.host);
    trigger().click();
    expect(rig.openDialog).not.toHaveBeenCalled();
    expect(hint()).toBe(POSTER_BUTTON_TEXT.onlyShards);
    expect(panel().hidden).toBe(false);
  });

  it('closes the explanation and opens the dialog once a card is selected', () => {
    openPage('/users/sena/cards', rowOf('alpha-s'));
    syncPosterButton(document, rig.host);
    trigger().click();
    rowElements()[0]?.classList.add('user-card--selected');
    trigger().click();
    expect(rig.openDialog).toHaveBeenCalledTimes(1);
    expect(panel().hidden).toBe(true);
  });
});
