import { beforeEach, describe, expect, it } from 'vitest';

import { memoryPlaceOf } from '../utils/sort/sort-places';

const windowOf = (hint: string, title = 'Твои карточки'): string => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header"><div><div>${title}</div><div class="modal-trade__header-hint">${hint}</div></div></header>
    <div class="modal-trade__body"><div class="modal-trade__header-form"></div><div class="modal-trade__body-result"></div></div>
  </div>`;

const toolbarIn = (selector: string): Element => {
  const toolbar = document.querySelector(selector);
  if (!toolbar) throw new Error(`missing ${selector}`);
  return toolbar;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('memoryPlaceOf', () => {
  it('names the inventory grid and the deck builder by their toolbars', () => {
    document.body.innerHTML = '<div class="user-card__filters"></div><div class="card-browse"><div class="card-browse__form"></div></div>';
    expect(memoryPlaceOf(toolbarIn('.user-card__filters'))).toBe('grid');
    expect(memoryPlaceOf(toolbarIn('.card-browse__form'))).toBe('deck');
  });

  it.each([
    ['Выбери до 50 карт, которые готов отдать взамен', 'trade'],
    ['Выбери 3 одинаковые карты для переплавки в 1 карту рангом выше', 'upgrade'],
    ['Выбери 1 карту для раскола на 2 карты рангом ниже', 'split'],
    ['Выбери 3 одинаковые карты для объединения в 1 анимированную', 'merge'],
  ] as const)('names a window by its hint «%s» as %s', (hint, place) => {
    document.body.innerHTML = windowOf(hint);
    expect(memoryPlaceOf(toolbarIn('.modal-trade__header-form'))).toBe(place);
  });

  it('names no place for the catalog step of the offer window or for a window it cannot tell', () => {
    document.body.innerHTML = windowOf('Выбери до 50 карт, которые хочешь от', 'Выбор карт из общего каталога');
    expect(memoryPlaceOf(toolbarIn('.modal-trade__header-form'))).toBeNull();
    document.body.innerHTML = windowOf('Что-то новое');
    expect(memoryPlaceOf(toolbarIn('.modal-trade__header-form'))).toBeNull();
  });

  it('names no place for a toolbar that is not one of ours, nor for a form outside a window', () => {
    document.body.innerHTML = '<div class="modal-trade__header-form"></div><div class="catalog-cnt__nav"></div>';
    expect(memoryPlaceOf(toolbarIn('.modal-trade__header-form'))).toBeNull();
    expect(memoryPlaceOf(toolbarIn('.catalog-cnt__nav'))).toBeNull();
  });
});
