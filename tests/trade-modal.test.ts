import { beforeEach, describe, expect, it } from 'vitest';

import { isCatalogStep, isPartnerStep, isUserCardsStep, windowModeOf } from '../utils/shared/trade-modal';

const tradeWindow = (title: string, hint: string, hasList = true) => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header"><div class="modal-trade__header-headline"><div>${title}</div><div class="modal-trade__header-hint">${hint}</div></div></header>
    <div class="modal-trade__body">${hasList ? '<div class="modal-trade__body-result"></div>' : '<div class="modal-trade__swap"></div>'}</div>
  </div>`;

const modal = () => document.querySelector('.modal-content--trade') as HTMLElement;

const STEPS = {
  partner: ['Выбор карточек', 'Выбери до 50 карт, которые хочешь от'],
  own: ['Твои карточки', 'Выбери до 50 карт, которые готов отдать взамен'],
  merge: ['Твои карточки', 'Выбери 3 одинаковые карты для объединения в 1 анимированную'],
  catalog: ['Выбор карт из общего каталога', 'Выбери до 50 карт, которые хочешь от'],
} as const;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the steps of a trade window', () => {
  it.each([
    ['partner', true, true],
    ['own', true, false],
    ['merge', true, false],
    ['catalog', false, false],
  ] as const)('tells the %s step: user cards %s, partner %s', (step, isUserCards, isPartner) => {
    document.body.innerHTML = tradeWindow(STEPS[step][0], STEPS[step][1]);
    expect(isUserCardsStep(modal())).toBe(isUserCards);
    expect(isPartnerStep(modal())).toBe(isPartner);
    expect(isCatalogStep(modal())).toBe(step === 'catalog');
  });

  it('is no user cards step without the list, whatever the header says', () => {
    document.body.innerHTML = tradeWindow('Выбор карточек', '', false);
    expect(isUserCardsStep(modal())).toBe(false);
    expect(isPartnerStep(modal())).toBe(false);
  });

  it('is no step of any kind in a window that has no header', () => {
    document.body.innerHTML = '<div class="modal-content modal-content--trade"><div class="modal-trade__body-result"></div></div>';
    expect(isCatalogStep(modal())).toBe(false);
    expect(isPartnerStep(modal())).toBe(false);
    expect(isUserCardsStep(modal())).toBe(true);
  });

  it('is no partner step when the header is empty or reworded', () => {
    document.body.innerHTML = tradeWindow('', '');
    expect(isPartnerStep(modal())).toBe(false);
    document.body.innerHTML = tradeWindow('Выбери карточки', 'Выбери до 50 карт, которые хочешь от');
    expect(isPartnerStep(modal())).toBe(false);
  });
});

describe('the mode of a trade window', () => {
  it.each([
    ['Выбор карточек', 'Выбери до 50 карт, которые хочешь от', 'trade'],
    ['Твои карточки', 'Выбери до 50 карт, которые готов отдать взамен', 'trade'],
    ['Твои карточки', 'Выбери 3 одинаковые карты для переплавки в 1 карту рангом выше', 'upgrade'],
    ['Твои карточки', 'Выбери 3 одинаковых осколка для переплавки в 1 целую карту', 'upgrade'],
    ['Твои карточки', 'Выбери 1 карту для раскола на 2 карты рангом ниже', 'split'],
    ['Твои карточки', 'Выбери 3 одинаковые карты для объединения в 1 анимированную', 'merge'],
  ] as const)('tells %s with «%s» as %s', (title, hint, mode) => {
    document.body.innerHTML = tradeWindow(title, hint);
    expect(windowModeOf(modal())).toBe(mode);
  });

  it('has no mode on the catalog step, which a trade hint also appears on', () => {
    document.body.innerHTML = tradeWindow(STEPS.catalog[0], STEPS.catalog[1]);
    expect(windowModeOf(modal())).toBeNull();
  });

  it('has no mode when the header is empty or says something else', () => {
    document.body.innerHTML = tradeWindow('', '');
    expect(windowModeOf(modal())).toBeNull();
    document.body.innerHTML = tradeWindow('Проверка обмена', 'Прими решение обмена', false);
    expect(windowModeOf(modal())).toBeNull();
  });
});
