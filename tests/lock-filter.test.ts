import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { MODAL_REFRESH_CLASS } from '../utils/trades/modal-refresh';
import {
  EMPTY_LOCK_NOTE_CLASS,
  LOCK_OPTIONS,
  LOCK_TITLES,
  MODAL_LOCK_CLASS,
  MODAL_LOCK_DROPDOWN_CLASS,
  MODAL_LOCK_POPPER_CLASS,
  createLockFilterButton,
  createLockFilterPopper,
  isCardLocked,
  syncModalLockButtons,
} from '../utils/trades/lock-filter';

const stylesheet = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/lock-filter.css'), 'utf8');

const modalHtml = ({
  title = 'Твои карточки',
  hasList = true,
  hasToolbar = true,
  hasRefresh = false,
  cards = '',
}: {
  title?: string;
  hasList?: boolean;
  hasToolbar?: boolean;
  hasRefresh?: boolean;
  cards?: string;
} = {}) => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header">
      <div class="modal-trade__header-headline"><h4 class="caption">${title}</h4></div>
    </header>
    <div class="modal-trade__body">
      ${
        hasToolbar
          ? `<div class="modal-trade__header-form">
               <button id="sort">sort</button>
               ${hasRefresh ? `<button class="button button--secondary button--icon button-size--md ${MODAL_REFRESH_CLASS}"></button>` : ''}
             </div>`
          : ''
      }
      ${hasList ? `<div class="modal-trade__body-result">${cards || '<div class="card-collect-preview"></div>'}</div>` : ''}
    </div>
  </div>`;

const findLockButton = () => document.querySelector<HTMLButtonElement>(`.${MODAL_LOCK_CLASS}`);
const findLockPopper = () => document.querySelector<HTMLElement>(`.${MODAL_LOCK_POPPER_CLASS}`);
const findDropdown = () => document.querySelector<HTMLElement>(`.${MODAL_LOCK_DROPDOWN_CLASS}`);
const findToolbar = () => document.querySelector('.modal-trade__header-form') as HTMLElement;
const findPicker = () => document.querySelector('.modal-trade__body') as HTMLElement;
const findEmptyNote = () => document.querySelector(`.${EMPTY_LOCK_NOTE_CLASS}`) as HTMLElement;

beforeEach(() => {
  document.head.innerHTML = `<style>${stylesheet}</style>`;
  document.body.innerHTML = '';
});

describe('createLockFilterPopper', () => {
  it('starts in initialView all with secondary button and lock icon, dropdown hidden', () => {
    let view = 'all';
    const popper = createLockFilterPopper('all', (next) => (view = next));
    document.body.append(popper);

    const button = popper.querySelector<HTMLButtonElement>(`.${MODAL_LOCK_CLASS}`)!;
    const dropdown = popper.querySelector<HTMLElement>(`.${MODAL_LOCK_DROPDOWN_CLASS}`)!;

    expect(button.className).toContain('button button--secondary button--icon');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('title')).toBe(LOCK_TITLES.all);
    expect(dropdown.hidden).toBe(true);

    const items = dropdown.querySelectorAll('.radio--list');
    expect(items).toHaveLength(3);
    expect([...items].map((i) => i.textContent?.trim())).toEqual(['Все карты', 'Без замка', 'С замком']);
  });

  it('toggles dropdown open and closed on button click', () => {
    const popper = createLockFilterPopper('all', () => undefined);
    document.body.append(popper);

    const button = popper.querySelector<HTMLButtonElement>(`.${MODAL_LOCK_CLASS}`)!;
    const dropdown = popper.querySelector<HTMLElement>(`.${MODAL_LOCK_DROPDOWN_CLASS}`)!;

    expect(dropdown.hidden).toBe(true);

    button.click();
    expect(dropdown.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    button.click();
    expect(dropdown.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects option, updates visuals, closes dropdown and triggers onChange', () => {
    const views: string[] = [];
    const popper = createLockFilterPopper('all', (next) => views.push(next));
    document.body.append(popper);

    const button = popper.querySelector<HTMLButtonElement>(`.${MODAL_LOCK_CLASS}`)!;
    const dropdown = popper.querySelector<HTMLElement>(`.${MODAL_LOCK_DROPDOWN_CLASS}`)!;

    button.click();
    expect(dropdown.hidden).toBe(false);

    const unlockedOption = dropdown.querySelector<HTMLElement>('[data-value="unlocked"]')!;
    unlockedOption.click();

    expect(views).toEqual(['unlocked']);
    expect(dropdown.hidden).toBe(true);
    expect(button.classList.contains('button--accent')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBe(LOCK_TITLES.unlocked);

    button.click();
    const lockedOption = dropdown.querySelector<HTMLElement>('[data-value="locked"]')!;
    lockedOption.click();

    expect(views).toEqual(['unlocked', 'locked']);
    expect(dropdown.hidden).toBe(true);
    expect(button.classList.contains('button--accent')).toBe(true);
    expect(button.getAttribute('title')).toBe(LOCK_TITLES.locked);

    button.click();
    const allOption = dropdown.querySelector<HTMLElement>('[data-value="all"]')!;
    allOption.click();

    expect(views).toEqual(['unlocked', 'locked', 'all']);
    expect(dropdown.hidden).toBe(true);
    expect(button.classList.contains('button--secondary')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('title')).toBe(LOCK_TITLES.all);
  });

  it('closes dropdown when clicking outside', () => {
    const popper = createLockFilterPopper('all', () => undefined);
    document.body.append(popper);

    const button = popper.querySelector<HTMLButtonElement>(`.${MODAL_LOCK_CLASS}`)!;
    const dropdown = popper.querySelector<HTMLElement>(`.${MODAL_LOCK_DROPDOWN_CLASS}`)!;

    button.click();
    expect(dropdown.hidden).toBe(false);

    document.body.click();
    expect(dropdown.hidden).toBe(true);
  });

  it('closes dropdown on Escape key', () => {
    const popper = createLockFilterPopper('all', () => undefined);
    document.body.append(popper);

    const button = popper.querySelector<HTMLButtonElement>(`.${MODAL_LOCK_CLASS}`)!;
    const dropdown = popper.querySelector<HTMLElement>(`.${MODAL_LOCK_DROPDOWN_CLASS}`)!;

    button.click();
    expect(dropdown.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dropdown.hidden).toBe(true);
  });
});

describe('isCardLocked', () => {
  it('detects card-collect-preview--locked and is-locked', () => {
    const el1 = document.createElement('div');
    el1.className = 'card-collect-preview card-collect-preview--locked';
    expect(isCardLocked(el1)).toBe(true);

    const el2 = document.createElement('div');
    el2.className = 'card-collect-preview is-locked';
    expect(isCardLocked(el2)).toBe(true);
  });

  it('detects lock icon elements inside card', () => {
    const el = document.createElement('div');
    el.className = 'card-collect-preview';
    el.innerHTML = '<div class="card-collect-preview__lock"></div>';
    expect(isCardLocked(el)).toBe(true);
  });

  it('detects lock SVG paths inside card', () => {
    const el = document.createElement('div');
    el.className = 'card-collect-preview';
    el.innerHTML = '<svg><path d="M240-80q-33 0-56.5-23.5T160-160v-400..."></path></svg>';
    expect(isCardLocked(el)).toBe(true);
  });

  it('returns false for plain card', () => {
    const el = document.createElement('div');
    el.className = 'card-collect-preview';
    expect(isCardLocked(el)).toBe(false);
  });
});

describe('syncModalLockButtons', () => {
  it('places the lock popper in the toolbar', () => {
    document.body.innerHTML = modalHtml();
    syncModalLockButtons();
    const popper = findLockPopper();
    expect(popper).not.toBeNull();
    expect(findToolbar().contains(popper)).toBe(true);
    expect(findLockButton()).not.toBeNull();
    expect(findDropdown()).not.toBeNull();
  });

  it('places the lock popper immediately before the refresh button when refresh is present', () => {
    document.body.innerHTML = modalHtml({ hasRefresh: true });
    syncModalLockButtons();
    const popper = findLockPopper();
    const refresh = document.querySelector(`.${MODAL_REFRESH_CLASS}`);
    expect(popper?.nextElementSibling).toBe(refresh);
  });

  it('does not add button when in catalog step', () => {
    document.body.innerHTML = modalHtml({ title: 'Выбор карт из общего каталога' });
    syncModalLockButtons();
    expect(findLockPopper()).toBeNull();
  });

  it('filters cards by setting data-senkutools-lock-view on picker', () => {
    document.body.innerHTML = modalHtml({
      cards: `
        <div class="card-collect-preview card-collect-preview--locked"></div>
        <div class="card-collect-preview"></div>
      `,
    });
    syncModalLockButtons();
    const dropdown = findDropdown()!;
    const picker = findPicker();

    expect(picker.hasAttribute('data-senkutools-lock-view')).toBe(false);

    // select unlocked
    dropdown.querySelector<HTMLElement>('[data-value="unlocked"]')?.click();
    expect(picker.getAttribute('data-senkutools-lock-view')).toBe('unlocked');

    // select locked
    dropdown.querySelector<HTMLElement>('[data-value="locked"]')?.click();
    expect(picker.getAttribute('data-senkutools-lock-view')).toBe('locked');

    // select all
    dropdown.querySelector<HTMLElement>('[data-value="all"]')?.click();
    expect(picker.hasAttribute('data-senkutools-lock-view')).toBe(false);
  });

  it('shows empty note when all cards are locked and unlocked filter is active', () => {
    document.body.innerHTML = modalHtml({
      cards: '<div class="card-collect-preview card-collect-preview--locked"></div>',
    });
    syncModalLockButtons();
    const dropdown = findDropdown()!;

    dropdown.querySelector<HTMLElement>('[data-value="unlocked"]')?.click();
    expect(findEmptyNote()?.textContent).toBe('Нет доступных карт (все заблокированы)');

    dropdown.querySelector<HTMLElement>('[data-value="locked"]')?.click();
    expect(findEmptyNote()).toBeNull();
  });

  it('shows empty note when no cards are locked and locked filter is active', () => {
    document.body.innerHTML = modalHtml({
      cards: '<div class="card-collect-preview"></div>',
    });
    syncModalLockButtons();
    const dropdown = findDropdown()!;

    dropdown.querySelector<HTMLElement>('[data-value="unlocked"]')?.click();
    expect(findEmptyNote()).toBeNull();

    dropdown.querySelector<HTMLElement>('[data-value="locked"]')?.click();
    expect(findEmptyNote()?.textContent).toBe('Нет заблокированных карт');
  });
});
