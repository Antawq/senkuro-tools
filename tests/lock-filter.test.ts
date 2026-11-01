import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lockIcon } from '../utils/shared/svg';
import {
  EMPTY_LOCK_TEXTS,
  isHiddenByLock,
  isRowLocked,
  LOCK_LABELS,
  LOCK_TITLES,
  removeLockControl,
  SITE_LOCK_PATH,
  syncLockControl,
  type LockView,
} from '../utils/trades/lock-filter';

const SITE_ICON_PATH =
  'M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920t141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80zm240-200q33 0 56.5-23.5T560-360t-23.5-56.5T480-440t-56.5 23.5T400-360t23.5 56.5T480-280M360-640h240v-80q0-50-35-85t-85-35-85 35-35 85z';

const lockTag = (path: string = SITE_ICON_PATH) =>
  `<div class="card-collect-preview__status"><span class="tag tag-size--md tag--dark"><svg viewBox="0 -960 960 960"><path d="${path}"></path></svg> 3 карты</span></div>`;

const row = (status: string) => `<div class="card-collect-preview" data-id="row"><a class="card-collect" href="/cards/a-f"></a>${status}</div>`;

const rowOf = (status: string): Element => {
  document.body.innerHTML = row(status);
  return document.querySelector('[data-id="row"]') as Element;
};

const toolbarHtml = (extra = '') =>
  `<div class="modal-trade__header-form"><button id="sort">По дате получения</button><button id="direction">Сначала</button>${extra}</div>`;

const toolbar = () => document.querySelector('.modal-trade__header-form') as HTMLElement;
const wrapper = () => document.querySelector<HTMLElement>('.senkutools-lock-filter');
const trigger = () => document.querySelector<HTMLButtonElement>('.senkutools-lock-filter__trigger');
const panel = () => document.querySelector<HTMLElement>('.senkutools-lock-filter__panel');
const radios = () => [...document.querySelectorAll<HTMLInputElement>('.senkutools-lock-filter__panel input[type="radio"]')];

const draw = (view: LockView = 'all') => {
  const picked: LockView[] = [];
  const select = vi.fn((next: LockView) => void picked.push(next));
  syncLockControl(toolbar(), view, select);
  return { picked, select, redraw: (next: LockView) => syncLockControl(toolbar(), next, select) };
};

const choose = (view: LockView) => {
  const radio = radios().find((candidate) => candidate.value === view);
  if (radio) radio.checked = true;
  radio?.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = toolbarHtml();
});

describe('the lock the site draws on a card row', () => {
  it('is the site lock path itself', () => {
    expect(SITE_LOCK_PATH).toBe(SITE_ICON_PATH);
  });

  it('marks a row whose status holds that icon, with or without a quantity beside it', () => {
    expect(isRowLocked(rowOf(lockTag()))).toBe(true);
    expect(isRowLocked(rowOf(`<div class="card-collect-preview__status"><span class="tag"><svg><path d="${SITE_ICON_PATH}"></path></svg></span></div>`))).toBe(
      true
    );
  });

  it.each([
    ['no status at all', ''],
    ['a quantity tag with no icon', '<div class="card-collect-preview__status"><span class="tag">3 карты</span></div>'],
    ['another icon in the status', lockTag('M480-424 284-228q-11 11-28 11t-28-11')],
    ['an icon that only starts like the lock', lockTag(`${SITE_ICON_PATH.slice(0, 120)}z`)],
    ['the lock outside the status', `<div class="card-collect-preview__front"><svg><path d="${SITE_ICON_PATH}"></path></svg></div>`],
    ['a class that only holds the letters "lock"', '<div class="card-collect-preview__status unblock block-lock"><span class="tag">3 карты</span></div>'],
  ])('leaves a row with %s alone', (_name, status) => {
    expect(isRowLocked(rowOf(status))).toBe(false);
  });

  it('reads only the status of the row itself, not one nested deeper', () => {
    document.body.innerHTML = row(`<div class="nested"><div class="card-collect-preview__status"><svg><path d="${SITE_ICON_PATH}"></path></svg></div></div>`);
    expect(isRowLocked(document.querySelector('[data-id="row"]') as Element)).toBe(false);
  });
});

describe('what each view hides', () => {
  it.each([
    ['all', true, false],
    ['all', false, false],
    ['unlocked', true, true],
    ['unlocked', false, false],
    ['locked', true, false],
    ['locked', false, true],
  ] as const)('the %s view with a locked row %s hides it: %s', (view, isLocked, hides) => {
    expect(isHiddenByLock(view, rowOf(isLocked ? lockTag() : ''))).toBe(hides);
  });
});

describe('the lock control', () => {
  it('stands last in the toolbar, an icon button made of the site classes with the one lock icon and no text', () => {
    draw();
    expect(toolbar().lastElementChild).toBe(wrapper());
    expect(trigger()?.className).toBe('button button--secondary button--icon button-size--md senkutools-lock-filter__trigger');
    expect(trigger()?.type).toBe('button');
    expect(trigger()?.textContent).toBe('');
    expect(trigger()?.querySelectorAll('svg')).toHaveLength(1);
    expect(trigger()?.querySelector('path')?.getAttribute('d')).toBe(lockIcon(20).querySelector('path')?.getAttribute('d'));
    expect(trigger()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stands before the search control and the refresh button, whichever of them was drawn first', () => {
    document.body.innerHTML = toolbarHtml('<button class="button senkutools-modal-refresh"></button><div class="senkutools-modal-search"></div>');
    draw();
    expect(wrapper()?.nextElementSibling?.classList.contains('senkutools-modal-refresh')).toBe(true);
    removeLockControl(toolbar());
    document.body.innerHTML = toolbarHtml('<div class="senkutools-modal-search"></div><button class="button senkutools-modal-refresh"></button>');
    draw();
    expect(wrapper()?.nextElementSibling?.classList.contains('senkutools-modal-search')).toBe(true);
  });

  it('lists the three views under the caption of the lock, with the first one checked', () => {
    draw();
    expect(panel()?.hidden).toBe(true);
    expect(panel()?.querySelector('.dropdown-menu__caption')?.textContent).toBe('Замок');
    expect([...(panel()?.querySelectorAll('label.radio.radio-size--md.radio--list') ?? [])].map((label) => label.textContent)).toEqual([
      'Все карты',
      'Без замка',
      'С замком',
    ]);
    expect(radios().map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(radios().every((radio) => radio.name === radios()[0]?.name)).toBe(true);
  });

  it('carries the dot of the site and a title that names the view while a view other than all is on', () => {
    const { redraw } = draw();
    expect(trigger()?.classList.contains('button--chip')).toBe(false);
    expect(trigger()?.title).toBe(LOCK_TITLES.all);
    redraw('locked');
    expect(trigger()?.classList.contains('button--chip')).toBe(true);
    expect(trigger()?.title).toBe(LOCK_TITLES.locked);
    expect(trigger()?.getAttribute('aria-label')).toBe(LOCK_TITLES.locked);
    expect(radios().map((radio) => radio.checked)).toEqual([false, false, true]);
    redraw('all');
    expect(trigger()?.classList.contains('button--chip')).toBe(false);
  });

  it('opens and closes the panel on the trigger, with aria-expanded, and puts the focus on the checked view', () => {
    draw('unlocked');
    trigger()?.click();
    expect(panel()?.hidden).toBe(false);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(radios()[1]);
    trigger()?.click();
    expect(panel()?.hidden).toBe(true);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('reports a chosen view once, closes the panel and gives the focus back to the trigger', () => {
    const { picked } = draw();
    trigger()?.click();
    choose('locked');
    expect(picked).toEqual(['locked']);
    expect(panel()?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('closes the panel on Escape and keeps that key from the window of the site, which closes on it', () => {
    draw();
    const reached = vi.fn();
    document.body.addEventListener('keydown', reached);
    trigger()?.click();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    radios()[0]?.dispatchEvent(event);
    expect(panel()?.hidden).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it('lets another key reach the window of the site', () => {
    draw();
    const reached = vi.fn();
    document.body.addEventListener('keydown', reached);
    trigger()?.click();
    radios()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(panel()?.hidden).toBe(false);
    expect(reached).toHaveBeenCalledOnce();
  });

  it('gives each control its own radio group, so two windows never share a choice', () => {
    const { select } = draw();
    const firstName = radios()[0]?.name;
    document.body.insertAdjacentHTML('beforeend', toolbarHtml());
    const second = document.querySelectorAll<HTMLElement>('.modal-trade__header-form')[1] as HTMLElement;
    syncLockControl(second, 'all', select);
    expect(second.querySelector<HTMLInputElement>('input[type="radio"]')?.name).not.toBe(firstName);
  });

  it('draws once however often it syncs and adds nothing to a toolbar it already stands in', () => {
    draw();
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((mutations) => records.push(...mutations));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    draw('locked');
    draw('locked');
    expect(document.querySelectorAll('.senkutools-lock-filter')).toHaveLength(1);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('is taken out with removeLockControl and drawn again, from a fresh start, by the next sync', () => {
    draw('locked');
    removeLockControl(toolbar());
    expect(wrapper()).toBeNull();
    draw('all');
    expect(radios().map((radio) => radio.checked)).toEqual([true, false, false]);
  });
});

describe('the interface strings of the lock filter', () => {
  it('keeps the labels and the empty notes', () => {
    expect(LOCK_LABELS).toEqual({ all: 'Все карты', unlocked: 'Без замка', locked: 'С замком' });
    expect(EMPTY_LOCK_TEXTS).toEqual({ unlocked: 'Нет доступных карт (все заблокированы)', locked: 'Нет заблокированных карт' });
  });
});
