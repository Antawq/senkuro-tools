import { beforeEach, describe, expect, it } from 'vitest';

import { childWithClass } from '../utils/shared/dom';
import { isCatalogStep, isPartnerStep, isUserCardsStep } from '../utils/shared/trade-modal';

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

  it('is no partner step when the header is empty or reworded', () => {
    document.body.innerHTML = tradeWindow('', '');
    expect(isPartnerStep(modal())).toBe(false);
    document.body.innerHTML = tradeWindow('Выбери карточки', 'Выбери до 50 карт, которые хочешь от');
    expect(isPartnerStep(modal())).toBe(false);
  });
});

describe('childWithClass', () => {
  it('finds a direct child by class and ignores a deeper one', () => {
    document.body.innerHTML = '<div id="parent"><div><span class="mark"></span></div><b class="mark" id="direct"></b></div>';
    expect(childWithClass(document.querySelector('#parent') as Element, 'mark')?.id).toBe('direct');
    expect(childWithClass(document.querySelector('#direct') as Element, 'mark')).toBeUndefined();
  });
});
