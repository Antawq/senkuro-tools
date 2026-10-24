import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MODAL_REFRESH_CLASS } from '../utils/trades/modal-refresh';
import { createShardSwitchWatcher, isPickerMutation, updateShardSwitches } from '../utils/trades/shard-switch';

const stylesheet = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/shard-switch.css'), 'utf8');

const row = (kind: 'card' | 'shard') => `<div class="card-collect-preview${kind === 'shard' ? ' card-collect-preview--shard' : ''}" data-kind="${kind}"></div>`;

const HINTS = {
  merge: ' Выбери 3 одинаковые карты для объединения в 1 анимированную',
  upgrade: ' Выбери 3 одинаковые карты для переплавки в 1 карту рангом выше',
  split: ' Выбери 1 карту для раскола на 2 карты рангом ниже',
  trade: ' Выбери до 50 карт, которые готов отдать взамен',
};

const header = (title: string, hint: string) =>
  `<header class="modal-trade__header"><div class="modal-trade__header-headline"><div class="caption">${title}</div><div class="modal-trade__header-hint">${hint}</div></div></header>`;

const tradeModal = (rows: string, hasMorePages = true, heading = '') => `
  <div class="modal-content modal-content--trade">
    ${heading}
    <div class="modal-trade__body scrollbar">
      <div class="modal-trade__header-form"><button>sort</button></div>
      <div class="modal-trade__body-result">${rows}${hasMorePages ? '<div class="sentinel"></div>' : ''}</div>
    </div>
  </div>`;

const picker = () => document.querySelector('.modal-trade__body') as HTMLElement;
const switchOf = () => document.querySelector('.senkutools-shard-switch');
const noteOf = () => document.querySelector('.senkutools-shard-switch__empty');
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.senkutools-shard-switch__button')];
const press = (label: string) =>
  buttons()
    .find((button) => button.textContent === label)
    ?.click();
const pressed = () => buttons().find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent;
const displayOf = (kind: 'card' | 'shard') => getComputedStyle(document.querySelector(`[data-kind="${kind}"]`) as Element).display;

beforeEach(() => {
  document.head.innerHTML = `<style>${stylesheet}</style>`;
  document.body.innerHTML = '';
});

describe('updateShardSwitches', () => {
  it('adds no switch to a list without shard rows, as in the upgrade and split windows and the catalog', () => {
    document.body.innerHTML = tradeModal(row('card') + row('card'));
    updateShardSwitches();
    expect(switchOf()).toBeNull();
  });

  it('puts a switch right before the list once a shard row is there, with the whole list shown first', () => {
    document.body.innerHTML = tradeModal(row('card') + row('shard'));
    updateShardSwitches();
    expect(switchOf()).not.toBeNull();
    expect(document.querySelector('.modal-trade__body-result')?.previousElementSibling).toBe(switchOf());
    expect(buttons().map((button) => button.textContent)).toEqual(['Все', 'Карты', 'Осколки']);
    expect(pressed()).toBe('Все');
    expect(picker().hasAttribute('data-senkutools-shard-view')).toBe(false);
  });

  it('adds the switch once however often it runs', () => {
    document.body.innerHTML = tradeModal(row('shard'));
    updateShardSwitches();
    updateShardSwitches();
    expect(document.querySelectorAll('.senkutools-shard-switch')).toHaveLength(1);
  });

  it('shows only cards or only shards on a click, and the whole list again on Все', () => {
    document.body.innerHTML = tradeModal(row('card') + row('shard'));
    updateShardSwitches();
    press('Осколки');
    expect(picker().getAttribute('data-senkutools-shard-view')).toBe('shards');
    expect(pressed()).toBe('Осколки');
    expect(displayOf('card')).toBe('none');
    expect(displayOf('shard')).not.toBe('none');
    press('Карты');
    expect(displayOf('shard')).toBe('none');
    expect(displayOf('card')).not.toBe('none');
    press('Все');
    expect(picker().hasAttribute('data-senkutools-shard-view')).toBe(false);
    expect(displayOf('card')).not.toBe('none');
    expect(displayOf('shard')).not.toBe('none');
  });

  it('never hides the element the site watches to load the next page', () => {
    document.body.innerHTML = tradeModal(row('card') + row('shard'));
    updateShardSwitches();
    for (const label of ['Осколки', 'Карты']) {
      press(label);
      expect(getComputedStyle(document.querySelector('.sentinel') as Element).display).not.toBe('none');
    }
  });

  it('keeps the choice and puts the switch back before a list the site draws anew', () => {
    document.body.innerHTML = tradeModal(row('card') + row('shard'));
    updateShardSwitches();
    press('Осколки');
    document.querySelector('.modal-trade__body-result')?.remove();
    picker().insertAdjacentHTML('beforeend', `<div class="modal-trade__body-result">${row('shard')}${row('card')}</div>`);
    updateShardSwitches();
    expect(document.querySelector('.modal-trade__body-result')?.previousElementSibling).toBe(switchOf());
    expect(pressed()).toBe('Осколки');
    expect(picker().getAttribute('data-senkutools-shard-view')).toBe('shards');
  });

  it('drops the switch and the choice when the list has no shard rows any more', () => {
    document.body.innerHTML = tradeModal(row('shard'));
    updateShardSwitches();
    press('Карты');
    document.querySelector('.modal-trade__body-result')?.remove();
    picker().insertAdjacentHTML('beforeend', `<div class="modal-trade__body-result">${row('card')}</div>`);
    updateShardSwitches();
    expect(switchOf()).toBeNull();
    expect(picker().hasAttribute('data-senkutools-shard-view')).toBe(false);
    expect(displayOf('card')).not.toBe('none');
  });

  it('keeps a separate choice for each open window', () => {
    document.body.innerHTML = tradeModal(row('shard') + row('card')) + tradeModal(row('shard') + row('card'));
    updateShardSwitches();
    const [first, second] = [...document.querySelectorAll<HTMLElement>('.modal-trade__body')];
    first?.querySelectorAll<HTMLButtonElement>('.senkutools-shard-switch__button')[1]?.click();
    expect(first?.getAttribute('data-senkutools-shard-view')).toBe('cards');
    expect(second?.hasAttribute('data-senkutools-shard-view')).toBe(false);
  });

  it('says there are no cards when the whole list is shards and Карты is chosen', () => {
    document.body.innerHTML = tradeModal(row('shard') + row('shard'), false);
    updateShardSwitches();
    expect(noteOf()).toBeNull();
    press('Карты');
    expect(noteOf()?.textContent).toBe('Нет карт');
    expect(document.querySelector('.modal-trade__body-result')?.previousElementSibling).toBe(noteOf());
    expect(noteOf()?.previousElementSibling).toBe(switchOf());
    press('Осколки');
    expect(noteOf()).toBeNull();
  });

  it('says nothing about an empty view while the site can still load more rows', () => {
    document.body.innerHTML = tradeModal(row('shard') + row('shard'), true);
    updateShardSwitches();
    press('Карты');
    expect(noteOf()).toBeNull();
  });

  it('takes the note away when a card arrives, keeping the switch in front of the list', () => {
    document.body.innerHTML = tradeModal(row('shard'), false);
    updateShardSwitches();
    press('Карты');
    document.querySelector('.modal-trade__body-result')?.insertAdjacentHTML('beforeend', row('card'));
    updateShardSwitches();
    expect(noteOf()).toBeNull();
    expect(document.querySelector('.modal-trade__body-result')?.previousElementSibling).toBe(switchOf());
  });

  it('keeps the switch before the note and the note before a list the site draws anew', () => {
    document.body.innerHTML = tradeModal(row('shard'), false);
    updateShardSwitches();
    press('Карты');
    document.querySelector('.modal-trade__body-result')?.remove();
    picker().insertAdjacentHTML('beforeend', `<div class="modal-trade__body-result">${row('shard')}</div>`);
    updateShardSwitches();
    expect(document.querySelector('.modal-trade__body-result')?.previousElementSibling).toBe(noteOf());
    expect(noteOf()?.previousElementSibling).toBe(switchOf());
    expect(document.querySelectorAll('.senkutools-shard-switch__empty')).toHaveLength(1);
  });

  describe('paging of the site in a view that hides rows', () => {
    const frames: (() => void)[] = [];
    const runFrames = (count = 2) => {
      for (let i = 0; i < count; i++) frames.splice(0).forEach((run) => run());
    };
    const sentinel = () => document.querySelector('.sentinel') as HTMLElement;
    const isParked = () => sentinel().hasAttribute('data-senkutools-paging-parked');
    const place = (element: Element, top: number, bottom: number) =>
      vi
        .spyOn(element, 'getBoundingClientRect')
        .mockReturnValue({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });

    beforeEach(() => {
      frames.length = 0;
      vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
    });

    it('moves the paging sentinel away for two frames and back, so the site sees it enter the view again', () => {
      document.body.innerHTML = tradeModal(row('card') + row('shard'));
      updateShardSwitches();
      expect(isParked()).toBe(false);
      press('Осколки');
      expect(isParked()).toBe(true);
      runFrames(1);
      expect(isParked()).toBe(true);
      runFrames(1);
      expect(isParked()).toBe(false);
    });

    it('parks it far outside the window with a rule of the stylesheet, not with a style set on the site element', () => {
      document.body.innerHTML = tradeModal(row('card') + row('shard'));
      updateShardSwitches();
      press('Осколки');
      expect(sentinel().getAttribute('style')).toBeNull();
      expect(getComputedStyle(sentinel()).transform).toContain('translateY(200000px)');
    });

    it('leaves the sentinel alone while the whole list is shown', () => {
      document.body.innerHTML = tradeModal(row('card') + row('shard'));
      updateShardSwitches();
      press('Осколки');
      runFrames();
      press('Все');
      expect(isParked()).toBe(false);
    });

    it('does it once for the rows it has, and again when more rows have arrived', () => {
      document.body.innerHTML = tradeModal(row('card') + row('shard'));
      updateShardSwitches();
      press('Осколки');
      runFrames();
      updateShardSwitches();
      expect(isParked()).toBe(false);
      document.querySelector('.modal-trade__body-result')?.insertAdjacentHTML('afterbegin', row('shard'));
      updateShardSwitches();
      expect(isParked()).toBe(true);
    });

    it('leaves a sentinel alone that is far below the visible part of the window', () => {
      document.body.innerHTML = tradeModal(row('card') + row('shard'));
      updateShardSwitches();
      place(sentinel(), 2000, 2000);
      place(picker(), 100, 500);
      press('Осколки');
      expect(isParked()).toBe(false);
    });

    it('has nothing to move when the list is complete', () => {
      document.body.innerHTML = tradeModal(row('card') + row('shard'), false);
      updateShardSwitches();
      expect(() => press('Осколки')).not.toThrow();
      expect(frames).toHaveLength(0);
    });
  });

  describe('the windows the switch belongs to, decided by the window and not by the rows loaded so far', () => {
    it('is there from the start in the windows that list cards and shards together, with no shard row loaded yet', () => {
      for (const hint of [HINTS.merge, HINTS.trade]) {
        document.body.innerHTML = tradeModal(row('card') + row('card'), true, header('Твои карточки', hint));
        updateShardSwitches();
        expect(switchOf(), hint).not.toBeNull();
        expect(pressed()).toBe('Все');
      }
    });

    it('is not there in the windows whose list never holds shards', () => {
      for (const heading of [
        header('Твои карточки', HINTS.upgrade),
        header('Твои карточки', HINTS.split),
        header('Выбор карт из общего каталога', HINTS.trade),
      ]) {
        document.body.innerHTML = tradeModal(row('card') + row('card'), true, heading);
        updateShardSwitches();
        expect(switchOf()).toBeNull();
      }
    });

    it('shows a shard row it finds even in a window it does not know', () => {
      document.body.innerHTML = tradeModal(row('card') + row('shard'), true, header('Твои карточки', ' Новая подсказка'));
      updateShardSwitches();
      expect(switchOf()).not.toBeNull();
    });

    it('lets the choice be made before shards are loaded, and says so when the list is complete and has none', () => {
      document.body.innerHTML = tradeModal(row('card'), false, header('Твои карточки', HINTS.merge));
      updateShardSwitches();
      press('Осколки');
      expect(noteOf()?.textContent).toBe('Нет осколков');
      expect(picker().getAttribute('data-senkutools-shard-view')).toBe('shards');
    });

    it('is not added while the window has no header text yet', () => {
      document.body.innerHTML = tradeModal(row('card'), true, '<header class="modal-trade__header"></header>');
      updateShardSwitches();
      expect(switchOf()).toBeNull();
    });
  });

  it('leaves every page and window other than the trade window alone', () => {
    document.body.innerHTML = `<div class="modal-content modal-content--review"><div class="modal-trade__body"><div class="modal-trade__body-result">${row('shard')}</div></div></div>
      <div class="user-cards"><div class="modal-trade__body-result">${row('shard')}</div></div>`;
    updateShardSwitches();
    expect(switchOf()).toBeNull();
  });

  it('ignores a window with no list, as in the check step', () => {
    document.body.innerHTML =
      '<div class="modal-content modal-content--trade"><div class="modal-trade__body"><div class="modal-trade__swap"></div></div></div>';
    expect(() => updateShardSwitches()).not.toThrow();
    expect(switchOf()).toBeNull();
  });
});

describe('isPickerMutation', () => {
  const record = (target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []) => ({ target, addedNodes, removedNodes }) as unknown as MutationRecord;

  it('is true for rows added to the list of the trade window', () => {
    document.body.innerHTML = tradeModal('');
    const list = document.querySelector('.modal-trade__body-result') as Element;
    expect(isPickerMutation(record(list, [document.createElement('div')]))).toBe(true);
  });

  it('is true for a trade window that was just added to the page', () => {
    document.body.innerHTML = tradeModal('');
    expect(isPickerMutation(record(document.body, [document.querySelector('.modal-content--trade') as Element]))).toBe(true);
  });

  it('is false for the empty-view note being added or removed', () => {
    document.body.innerHTML = tradeModal(row('shard'), false);
    updateShardSwitches();
    press('Карты');
    const note = noteOf() as Element;
    expect(isPickerMutation(record(picker(), [note]))).toBe(false);
    expect(isPickerMutation(record(picker(), [], [note]))).toBe(false);
  });

  it('is false for the switch itself being added, removed or clicked', () => {
    document.body.innerHTML = tradeModal(row('shard'));
    updateShardSwitches();
    const own = switchOf() as Element;
    expect(isPickerMutation(record(picker(), [own]))).toBe(false);
    expect(isPickerMutation(record(picker(), [], [own]))).toBe(false);
    expect(isPickerMutation(record(own, [document.createElement('span')]))).toBe(false);
  });

  it('is false for the refresh button of the window being added or removed', () => {
    document.body.innerHTML = tradeModal(row('shard'));
    const own = document.createElement('button');
    own.className = MODAL_REFRESH_CLASS;
    expect(isPickerMutation(record(picker(), [own]))).toBe(false);
    expect(isPickerMutation(record(picker(), [], [own]))).toBe(false);
    expect(isPickerMutation(record(own, [document.createElement('span')]))).toBe(false);
  });

  it('is false for a change outside the trade window', () => {
    document.body.innerHTML = tradeModal('') + '<div class="elsewhere"></div>';
    expect(isPickerMutation(record(document.querySelector('.elsewhere') as Element, [document.createElement('div')]))).toBe(false);
  });
});

describe('createShardSwitchWatcher', () => {
  const watcherRig = () => {
    const frames: (() => void)[] = [];
    const nextFrame = vi.fn((run: () => void) => void frames.push(run));
    const watcher = createShardSwitchWatcher({ nextFrame });
    document.body.innerHTML = tradeModal(row('shard'));
    const mutation = {
      target: document.querySelector('.modal-trade__body-result'),
      addedNodes: [document.createElement('div')],
      removedNodes: [],
    } as unknown as MutationRecord;
    return { frames, nextFrame, watcher, mutation };
  };

  it('updates the switches in the next frame after a change in the trade window', () => {
    const { frames, watcher, mutation } = watcherRig();
    watcher.watch([mutation]);
    expect(switchOf()).toBeNull();
    frames.forEach((run) => run());
    expect(switchOf()).not.toBeNull();
  });

  it('asks for one frame however many changes come before it', () => {
    const { nextFrame, watcher, mutation } = watcherRig();
    watcher.watch([mutation, mutation]);
    watcher.watch([mutation]);
    expect(nextFrame).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing when no change is in the trade window', () => {
    const { nextFrame, watcher } = watcherRig();
    watcher.watch([{ target: document.body, addedNodes: [document.createElement('p')], removedNodes: [] } as unknown as MutationRecord]);
    expect(nextFrame).not.toHaveBeenCalled();
  });

  it('can ask again once the frame has run', () => {
    const { frames, nextFrame, watcher, mutation } = watcherRig();
    watcher.watch([mutation]);
    frames.splice(0).forEach((run) => run());
    watcher.watch([mutation]);
    expect(nextFrame).toHaveBeenCalledTimes(2);
  });
});
