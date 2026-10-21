import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../utils/settings';
import { REPLAY_EVENT, createTradeStore } from '../utils/trade-capture';
import { isTradeMutation, updateTradeSummaries } from '../utils/trade-summary';

const db = {
  's-card': { price: 1.25, rank: 'S' },
  'a-card': { price: 1.5, rank: 'A' },
  'f-card': { price: 1.25, rank: 'F' },
  'r-card': { price: 1.25, rank: 'R' },
  'r-rare': { price: 2, rank: 'R' },
  atiss: { price: 1.25, rank: 'D', name: 'Атисс' },
  mikhail: { price: 1.25, rank: 'F' },
  soran: { price: 1.25, rank: 'F' },
  gu: { price: 1.25, rank: 'D' },
  kan: { price: 2, rank: 'B' },
  gran: { price: 1.25, rank: 'C' },
  mar: { price: 1.5, rank: 'C' },
  yn: { price: 1.25, rank: 'F' },
  anis: { price: 3, rank: 'C' },
};

const phaivroh = [
  ['atiss', 2],
  ['mikhail', 1],
  ['soran', 3],
  ['gu', 3],
];
const sky = [
  ['kan', 1],
  ['gran', 1],
  ['mar', 1],
  ['yn', 2],
  ['anis', 1],
];
const previews = (list) => list.map(([slug, quantity]) => ({ slug, quantity, shard: false }));
const cardsOf = (list) => list.map(([slug, quantity]) => card(slug, quantity));
const skyTrade = {
  kind: 'trade',
  id: 't1',
  source: { id: 'u1', name: 'Phaivroh | WL' },
  destination: { id: 'u2', name: 'Молюсь на Sky | WS' },
  offer: previews(phaivroh),
  request: previews(sky),
};
const skySides = ['Получаешь 19F Банк 5D 4F Карты 5D 4F', 'Отдаёшь 86.6F Банк 1.6B 4.6C 2F Карты 1B 3C 2F'];

const settings = { ...DEFAULT_SETTINGS };

let store;

const card = (slug, quantity = 1, shard = false) => `
  <div class="card-collect-preview${shard ? ' card-collect-preview--shard' : ''} modal-trade__card">
    <div class="card-collect-preview__status">${quantity > 1 ? `<span> ${quantity}</span>` : ''}</div>
    <div class="card-collect-preview__flip-container">
      <div class="card-collect-preview__front"><a class="card-collect" href="/cards/${slug}"><img alt=""></a></div>
    </div>
  </div>`;

const constructorFooter = (requests, offers) => `
  <div class="modal-trade__footer">
    <div class="modal-trade__preview">
      <div class="modal-trade__preview-el"><div class="modal-trade__preview-list"><div class="modal-trade__preview-cnt">${requests.join('')}</div></div></div>
      <svg class="modal-trade__preview-icon"></svg>
      <div class="modal-trade__preview-el"><div class="modal-trade__preview-list"><div class="modal-trade__preview-cnt">${offers.join('')}</div></div></div>
    </div>
    <div class="modal-trade__actions"><button>Назад</button><button>К итогу</button></div>
  </div>`;

const panel = (name, total, cards) => `
  <div class="modal-trade__swap-el">
    <div class="card-list"><div class="card-body"><div class="card-name"><span>${name}</span></div><div class="card-info">${total} карт</div></div></div>
    <div class="modal-trade__swap-cards">${cards.slice(0, 3).join('')}<div class="modal-trade__swap-tag">Обменяет</div></div>
  </div>`;

const reviewFooter = `
  <div class="modal-trade__footer">
    <div class="modal-trade__footer-widjet"></div>
    <div class="modal-trade__footer-info">После отправки Карты изменить не получится</div>
    <div class="modal-trade__actions"></div>
  </div>`;

const reviewBody = (left, right) => `
  <div class="modal-trade__body scrollbar">
    <div class="modal-trade__swap modal-trade__swap--col">${left}<div class="modal-trade__swap-icon"></div>${right}</div>
  </div>`;

const modal = (subtitle, inner) => {
  const el = document.createElement('div');
  el.className = 'modal-content modal-content--trade scrollbar';
  el.innerHTML = `<header><div>Заголовок</div><div>${subtitle}</div></header>${inner}`;
  document.body.append(el);
  return el;
};

const summaryOf = (el) => {
  const summary = el.querySelector('.senkuro-trade-summary');
  const table = summary?.querySelector('.senkuro-trade-summary__table');
  if (!table) return null;
  const width = Number(table.style.getPropertyValue('--senkuro-columns')) + 1;
  const cells = [...table.children];
  const rows = Array.from({ length: cells.length / width }, (_, index) => cells.slice(index * width, (index + 1) * width));
  const [head, ...body] = rows;
  return {
    sides: head
      .slice(1)
      .map((title, index) =>
        [
          title.textContent,
          ...body.map(([label, ...values]) => `${label.textContent === 'Ценность' ? '' : `${label.textContent} `}${values[index].textContent}`),
        ].join(' ')
      ),
    verdict: summary.querySelector('.senkuro-trade-summary__verdict')?.textContent ?? null,
    grayVerdict: Boolean(summary.querySelector('.senkuro-trade-summary__verdict.senkuro-trade-summary__unknown')),
  };
};

beforeEach(() => {
  document.body.replaceChildren();
  store = createTradeStore();
});

describe('updateTradeSummaries', () => {
  it('sums every selected card while the trade is being composed', () => {
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card', 2)], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Получаешь 194.4F Банк 2.4A Карты 2A', 'Отдаёшь 243F Банк 1S Карты 1S'],
      verdict: 'Потеря -48.6F (-20%)',
      grayVerdict: false,
    });
  });

  it('sums the cards by their rank alone when the value follows the cards', () => {
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card', 2)], [card('s-card')]));
    updateTradeSummaries(db, { ...settings, valueBasis: 'cards' }, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Получаешь 162F Банк 2.4A Карты 2A', 'Отдаёшь 243F Банк 1S Карты 1S'],
      verdict: 'Потеря -81F (-33%)',
      grayVerdict: false,
    });
  });

  it('draws the total again when the basis is switched', () => {
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card', 2)], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el).verdict).toBe('Потеря -48.6F (-20%)');
    updateTradeSummaries(db, { ...settings, valueBasis: 'cards' }, store);
    expect(summaryOf(el).verdict).toBe('Потеря -81F (-33%)');
    updateTradeSummaries(db, { ...settings, valueBasis: 'bank' }, store);
    expect(summaryOf(el).verdict).toBe('Потеря -48.6F (-20%)');
  });

  it('keeps the exact selection on the own review step where only three cards per side are drawn', () => {
    const offers = [card('s-card'), card('s-card'), card('s-card'), card('f-card'), card('f-card')];
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card')], offers));
    updateTradeSummaries(db, settings, store);
    el.querySelector('.modal-trade__footer').remove();
    el.insertAdjacentHTML('beforeend', reviewBody(panel('Я', 5, offers), panel('Он', 1, [card('a-card')])) + reviewFooter);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el).sides).toEqual(['Отдаёшь 731F Банк 3S 2F Карты 3S 2F', 'Получаешь 97.2F Банк 1.2A Карты 1A']);
  });

  it('drops a remembered selection that no longer matches the drawn cards', () => {
    const offers = [card('s-card'), card('s-card'), card('s-card'), card('f-card'), card('f-card')];
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card')], offers));
    updateTradeSummaries(db, settings, store);
    el.querySelector('.modal-trade__footer').remove();
    const drawn = [card('s-card', 2), card('s-card'), card('s-card')];
    el.insertAdjacentHTML('beforeend', reviewBody(panel('Я', 5, drawn), panel('Он', 1, [card('a-card')])) + reviewFooter);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el).sides[0]).toBe('Отдаёшь 972F Банк 4S 2X Карты 4S 2X');
  });

  it('asks the page for the trades again once when an incoming trade has no data', () => {
    const asked = vi.fn();
    document.addEventListener(REPLAY_EVENT, asked);
    const el = modal('Прими решение обмена', reviewBody(panel('Отправитель', 6, [card('s-card')]), panel('Я', 1, [card('s-card')])) + reviewFooter);
    updateTradeSummaries(db, settings, store);
    updateTradeSummaries(db, settings, store);
    document.removeEventListener(REPLAY_EVENT, asked);
    expect(asked).toHaveBeenCalledOnce();
    expect(summaryOf(el).sides[0]).toContain('5X');
  });

  it('takes a whole side from the card list the site opens on click', () => {
    const el = modal(
      'Прими решение обмена',
      reviewBody(panel('Phaivroh | WL', 4, cardsOf(phaivroh)), panel('Молюсь на Sky | WS', 5, cardsOf(sky))) + reviewFooter
    );
    const list = document.createElement('div');
    list.className = 'modal-content modal-content--review';
    list.innerHTML = `<div class="modal-trade__review"><div class="modal-trade__review-header"><div class="modal-trade__review-text">Которые ты просишь у Phaivroh | WL</div></div><div class="modal-trade__review-slider">${cardsOf(phaivroh).join('')}</div></div>`;
    document.body.append(list);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el).sides).toEqual([skySides[0], 'Отдаёшь 63F Банк 1.6B 2.2C 2X Карты 1B 2C 2X']);
  });

  it('marks the cards an incoming trade does not draw as gray X and explains the mark', () => {
    const offers = [card('s-card'), card('s-card'), card('f-card')];
    const el = modal('Прими решение обмена', reviewBody(panel('Отправитель', 6, offers), panel('Я', 1, [card('s-card')])) + reviewFooter);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Получаешь 487F Банк 2S 1F 3X Карты 2S 1F 3X', 'Отдаёшь 243F Банк 1S Карты 1S'],
      verdict: 'Выгода +244F (+100%)',
      grayVerdict: false,
    });
    expect(el.querySelector('.senkuro-trade-summary__cell strong.senkuro-trade-summary__unknown').textContent).toBe('487F');
    expect(el.querySelector('.senkuro-trade-summary__verdict').classList.contains('senkuro-trade-summary__verdict--gain')).toBe(true);
    expect(el.querySelector('.senkuro-trade-summary__panel > .senkuro-trade-summary__unknown').textContent).toBe('X - нет цены в базе');
  });

  it('colours a loss red when cards without a price sit next to priced ones', () => {
    const el = modal('Прими решение обмена', reviewBody(panel('Отправитель', 3, [card('f-card')]), panel('Я', 1, [card('s-card')])) + reviewFooter);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toMatchObject({ verdict: 'Потеря -242F (-100%)', grayVerdict: false });
    expect(el.querySelector('.senkuro-trade-summary__verdict').classList.contains('senkuro-trade-summary__verdict--loss')).toBe(true);
  });

  it('keeps the verdict gray when a whole side has no price to compare', () => {
    const el = modal('Прими решение обмена', reviewBody(panel('Отправитель', 1, [card('missing')]), panel('Я', 1, [card('s-card')])) + reviewFooter);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toMatchObject({ grayVerdict: true });
    expect(el.querySelector('.senkuro-trade-summary__verdict--loss')).toBeNull();
  });

  it('leaves the X legend out when every card has a price', () => {
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card', 2)], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector('.senkuro-trade-summary__panel > .senkuro-trade-summary__unknown')).toBeNull();
  });

  it('leaves the X legend out when neither row that shows X is on', () => {
    const el = modal('Прими решение обмена', reviewBody(panel('Отправитель', 4, [card('s-card')]), panel('Я', 1, [card('s-card')])) + reviewFooter);
    updateTradeSummaries(db, { ...settings, showSummaryBank: false, showSummaryCards: false }, store);
    expect(el.querySelector('.senkuro-trade-summary__panel > .senkuro-trade-summary__unknown')).toBeNull();
  });

  it('takes the whole incoming trade from the site responses instead of gray X', () => {
    store.add({ viewerId: 'u2', items: [skyTrade] });
    const el = modal(
      'Прими решение обмена',
      reviewBody(panel('Phaivroh | WL', 4, cardsOf(phaivroh)), panel('Молюсь на Sky | WS', 5, cardsOf(sky))) + reviewFooter
    );
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({ sides: skySides, verdict: 'Потеря -67.6F (-78%)', grayVerdict: false });
  });

  it('folds shards into F and lists them with the cards', () => {
    const el = modal('', constructorFooter([card('s-card', 5, true), card('a-card')], [card('missing')]));
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Получаешь 218.7F Банк 1.2A 5oS Карты 1A 5oS', 'Отдаёшь 0F Банк 1X Карты 1X'],
      verdict: 'Выгода +218.7F',
      grayVerdict: true,
    });
    expect(el.querySelector('.senkuro-trade-summary__verdict--shards')).toBeNull();
  });

  it('marks shards of a card missing from the database as gray oX', () => {
    const el = modal('', constructorFooter([card('missing', 3, true), card('missing')], [card('f-card')]));
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el).sides[0]).toContain('Карты 1X 3oX');
    expect(summaryOf(el).grayVerdict).toBe(true);
  });

  it('stays away from the forge, which has no trade partner', () => {
    const el = modal(
      'Выбери 3 одинаковые карты',
      `<div class="modal-trade__footer"><div class="modal-trade__preview"><div class="modal-trade__preview-el"><div class="modal-trade__preview-list">${card('s-card')}</div></div></div></div>`
    );
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toBeNull();
  });

  it('folds the summary when every card is unselected and unfolds the same block again', () => {
    const el = modal('', constructorFooter([card('a-card')], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    const summary = el.querySelector('.senkuro-trade-summary');
    const lists = el.querySelectorAll('.modal-trade__preview-cnt');
    lists.forEach((list) => list.replaceChildren());
    updateTradeSummaries(db, settings, store);
    expect(summary.classList.contains('senkuro-trade-summary--closed')).toBe(true);
    lists[1].insertAdjacentHTML('beforeend', card('f-card'));
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector('.senkuro-trade-summary')).toBe(summary);
    expect(summary.classList.contains('senkuro-trade-summary--closed')).toBe(false);
    expect(summaryOf(el).sides[1]).toBe('Отдаёшь 1F Банк 1F Карты 1F');
  });

  it('hides the table behind a toggle that keeps its state across redraws', () => {
    const el = modal('', constructorFooter([card('a-card')], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    const summary = el.querySelector('.senkuro-trade-summary');
    const toggle = () => summary.querySelector('.senkuro-trade-summary__toggle');
    const state = () => [toggle().getAttribute('aria-label'), toggle().getAttribute('aria-expanded')];
    expect(summary.classList.contains('senkuro-trade-summary--collapsible')).toBe(true);
    expect(state()).toEqual(['Подробности', 'false']);
    let bubbled = false;
    el.addEventListener('click', () => (bubbled = true));
    toggle().click();
    expect(bubbled).toBe(false);
    expect(summary.classList.contains('senkuro-trade-summary--expanded')).toBe(true);
    el.querySelectorAll('.modal-trade__preview-cnt')[1].insertAdjacentHTML('beforeend', card('f-card'));
    updateTradeSummaries(db, settings, store);
    expect(state()).toEqual(['Подробности', 'true']);
  });

  it('places the details after the verdict that holds the toggle, so reading on from the button reaches the table', () => {
    const el = modal('', constructorFooter([card('r-card', 2)], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    const parts = [...el.querySelector('.senkuro-trade-summary__content').children];
    const main = parts.find((part) => part.matches('.senkuro-trade-summary__verdict:not(.senkuro-trade-summary__verdict--r)'));
    const details = parts.find((part) => part.matches('.senkuro-trade-summary__details'));
    const rVerdict = parts.find((part) => part.matches('.senkuro-trade-summary__verdict--r'));
    expect(parts.indexOf(main)).toBeLessThan(parts.indexOf(details));
    expect(parts.indexOf(details)).toBeLessThan(parts.indexOf(rVerdict));
  });

  it('puts the toggle in the main verdict, so the verdict keeps its own text and the R verdict stays plain', () => {
    const el = modal('', constructorFooter([card('r-card', 2)], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    const main = el.querySelector('.senkuro-trade-summary__verdict:not(.senkuro-trade-summary__verdict--r)');
    const toggle = main.querySelector('.senkuro-trade-summary__toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toBe('');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(main.textContent).toBe('Потеря -243F (-100%)');
    expect(el.querySelectorAll('.senkuro-trade-summary__toggle')).toHaveLength(1);
    expect(el.querySelector('.senkuro-trade-summary__verdict--r .senkuro-trade-summary__toggle')).toBeNull();
  });

  it('does not touch the summary when nothing changed', () => {
    const el = modal('', constructorFooter([card('a-card')], [card('s-card')]));
    updateTradeSummaries(db, settings, store);
    const first = el.querySelector('.senkuro-trade-summary__table');
    const content = el.querySelector('.senkuro-trade-summary__content');
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector('.senkuro-trade-summary__table')).toBe(first);
    updateTradeSummaries(db, { ...settings, commission: false }, store);
    expect(el.querySelector('.senkuro-trade-summary__table')).not.toBe(first);
    updateTradeSummaries(db, { ...settings, commission: false, valueBySplit: true }, store);
    expect(summaryOf(el).sides).toEqual(['Получаешь 24F Банк 1.5A Карты 1A', 'Отдаёшь 40F Банк 1.25S Карты 1S']);
    expect(el.querySelector('.senkuro-trade-summary__content')).toBe(content);
  });
});

describe('summary settings', () => {
  const labelsOf = (el) => [...el.querySelectorAll('.senkuro-trade-summary__table > .senkuro-trade-summary__label')].map((label) => label.textContent);
  const composing = () => modal('', constructorFooter([card('a-card')], [card('s-card')]));

  it('shows the value, bank and cards rows by default', () => {
    const el = composing();
    updateTradeSummaries(db, settings, store);
    expect(labelsOf(el)).toEqual(['Ценность', 'Банк', 'Карты']);
  });

  it.each([
    ['showSummaryF', 'Ценность'],
    ['showSummaryBank', 'Банк'],
    ['showSummaryCards', 'Карты'],
  ])('leaves out the row switched off by %s', (key, label) => {
    const el = composing();
    updateTradeSummaries(db, { ...settings, [key]: false }, store);
    const labels = labelsOf(el);
    expect(labels).toHaveLength(2);
    expect(labels).not.toContain(label);
  });

  it('redraws the table when a row is switched off and on again', () => {
    const el = composing();
    updateTradeSummaries(db, settings, store);
    const first = el.querySelector('.senkuro-trade-summary__table');
    updateTradeSummaries(db, { ...settings, showSummaryBank: false }, store);
    expect(el.querySelector('.senkuro-trade-summary__table')).not.toBe(first);
    expect(labelsOf(el)).toEqual(['Ценность', 'Карты']);
    updateTradeSummaries(db, settings, store);
    expect(labelsOf(el)).toEqual(['Ценность', 'Банк', 'Карты']);
  });

  it('leaves out the verdict together with the toggle that unfolds the table', () => {
    const el = composing();
    updateTradeSummaries(db, { ...settings, showSummaryVerdict: false }, store);
    const summary = el.querySelector('.senkuro-trade-summary');
    expect(summaryOf(el).verdict).toBeNull();
    expect(summary.querySelector('.senkuro-trade-summary__toggle')).toBeNull();
    expect(summary.classList.contains('senkuro-trade-summary--collapsible')).toBe(false);
    expect(summaryOf(el).sides).toHaveLength(2);
  });

  it('brings the verdict back when it is switched on again', () => {
    const el = composing();
    updateTradeSummaries(db, { ...settings, showSummaryVerdict: false }, store);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el).verdict).toBe('Потеря -145.8F (-60%)');
    expect(el.querySelector('.senkuro-trade-summary__toggle')).not.toBeNull();
  });
});

describe('R window', () => {
  const composing = (requests, offers) => modal('', constructorFooter(requests, offers));
  const windowOf = (el) => {
    const window = el.querySelector('.senkuro-trade-summary__window');
    if (!window) return null;
    const table = window.querySelector('.senkuro-trade-summary__table');
    const width = Number(table.style.getPropertyValue('--senkuro-columns')) + 1;
    const cells = [...table.children].map((cell) => cell.textContent);
    return {
      title: window.querySelector('.senkuro-trade-summary__window-title').textContent,
      rows: Array.from({ length: cells.length / width }, (_, index) => cells.slice(index * width, (index + 1) * width)),
      verdict: el.querySelector('.senkuro-trade-summary__verdict--r')?.textContent ?? null,
    };
  };

  it('stays away when no R card is involved', () => {
    const el = composing([card('a-card')], [card('s-card')]);
    updateTradeSummaries(db, settings, store);
    expect(windowOf(el)).toBeNull();
    expect(el.querySelector('.senkuro-trade-summary__verdict--r')).toBeNull();
  });

  it('opens with the R value and the R cards when one side has R', () => {
    const el = composing([card('r-card', 2)], [card('s-card')]);
    updateTradeSummaries(db, settings, store);
    expect(windowOf(el)).toEqual({
      title: 'R',
      rows: [
        ['Ценность', '2R', '-'],
        ['Карты', '2R', '-'],
      ],
      verdict: 'R: Выгода +2R',
    });
  });

  it('keeps the F verdict settled while R is counted on its own', () => {
    const el = composing([card('r-card', 2)], [card('s-card')]);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toMatchObject({ verdict: 'Потеря -243F (-100%)', grayVerdict: false });
    expect(summaryOf(el).sides[0]).toBe('Получаешь 0F Банк 2R Карты 2R');
    expect(el.querySelector('.senkuro-trade-summary__verdict--r').classList.contains('senkuro-trade-summary__verdict--gain')).toBe(true);
  });

  it('compares the R of both sides', () => {
    const el = composing([card('r-rare')], [card('r-card', 2)]);
    updateTradeSummaries(db, settings, store);
    expect(windowOf(el)).toEqual({
      title: 'R',
      rows: [
        ['Ценность', '1.6R', '2R'],
        ['Карты', '1R', '2R'],
      ],
      verdict: 'R: Потеря -0.4R (-20%)',
    });
    expect(summaryOf(el).verdict).toBe('Равноценно');
  });

  it('lists R shards and marks the R value as not settled', () => {
    const el = composing([card('r-card', 3, true)], [card('s-card')]);
    updateTradeSummaries(db, settings, store);
    expect(windowOf(el).rows).toEqual([
      ['Ценность', '0R', '-'],
      ['Карты', '3oR', '-'],
    ]);
    expect(el.querySelector('.senkuro-trade-summary__window strong').classList.contains('senkuro-trade-summary__unknown')).toBe(true);
    expect(el.querySelector('.senkuro-trade-summary__verdict--r').classList.contains('senkuro-trade-summary__unknown')).toBe(true);
  });

  it('folds together with the table', () => {
    const el = composing([card('r-card')], [card('s-card')]);
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector('.senkuro-trade-summary__details .senkuro-trade-summary__window')).not.toBeNull();
    expect(el.querySelector('.senkuro-trade-summary__details .senkuro-trade-summary__verdict--r')).toBeNull();
  });

  it('keeps the window but drops the R verdict when the verdict is switched off', () => {
    const el = composing([card('r-card')], [card('s-card')]);
    updateTradeSummaries(db, { ...settings, showSummaryVerdict: false }, store);
    expect(windowOf(el).verdict).toBeNull();
    expect(windowOf(el).rows[0]).toEqual(['Ценность', '1R', '-']);
  });

  it('closes the window when the R card is taken out of the trade', () => {
    const el = composing([card('r-card')], [card('s-card')]);
    updateTradeSummaries(db, settings, store);
    expect(windowOf(el)).not.toBeNull();
    el.querySelectorAll('.modal-trade__preview-cnt')[0].replaceChildren(...[...document.createRange().createContextualFragment(card('a-card')).children]);
    updateTradeSummaries(db, settings, store);
    expect(windowOf(el)).toBeNull();
  });
});

describe('summary variants', () => {
  const offerCard = (markup) => {
    store.add({
      items: [
        {
          kind: 'offer',
          id: 'o7',
          author: { id: 'u7', name: 'Smile' },
          viewerDidAuthor: false,
          offer: previews([['f-card', 1]]),
          request: previews([['s-card', 1]]),
        },
      ],
    });
    const el = document.createElement('div');
    el.className = 'offer-card';
    el.innerHTML = markup;
    document.body.append(el);
    return el;
  };

  const top = `<div class="offer-card__top"><h3><span>Smile</span></h3><div class="offer-card__top-list">${card('f-card')}</div></div>`;
  const list = `<div class="offer-card__cnt-list">${card('s-card')}</div>`;

  it('puts the summary of a fast trade at the end of the surface of the card', () => {
    const el = offerCard(`${top}<div class="offer-card__cnt">${list}<button>Предложить карты</button></div>`);
    updateTradeSummaries(db, settings, store);
    const summary = el.querySelector('.offer-card__cnt > .senkuro-trade-summary');
    expect(summary).not.toBeNull();
    expect(summary.parentElement.lastElementChild).toBe(summary);
    expect(summary.classList.contains('senkuro-trade-summary--offer')).toBe(true);
    expect(summary.classList.contains('senkuro-trade-summary--end')).toBe(true);
    expect(el.querySelector(':scope > .senkuro-trade-summary')).toBeNull();
  });

  it('stays below the header when a wrapper holds the header and the surface together', () => {
    const el = offerCard(`<div class="wrapper">${top}<div class="offer-card__cnt"><div class="inner">${list}</div></div></div>`);
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector('.offer-card__cnt > .senkuro-trade-summary')).not.toBeNull();
    expect(el.querySelector('.wrapper > .senkuro-trade-summary')).toBeNull();
  });

  it('falls back to the card itself when it has no surface of its own inside', () => {
    const el = offerCard(`${top}${list}`);
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector(':scope > .senkuro-trade-summary')).not.toBeNull();
  });

  it('keeps a single summary in the card across updates', () => {
    const el = offerCard(`${top}<div class="offer-card__cnt">${list}</div>`);
    updateTradeSummaries(db, settings, store);
    updateTradeSummaries(db, settings, store);
    expect(el.querySelectorAll('.senkuro-trade-summary')).toHaveLength(1);
  });

  it('leaves the summaries of modals, history entries and notifications as they are', () => {
    const el = modal('', constructorFooter([card('a-card')], [card('s-card')]));
    store.add({ viewerId: 'u2', items: [skyTrade] });
    const entry = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector('.senkuro-trade-summary').classList.contains('senkuro-trade-summary--offer')).toBe(false);
    expect(entry.querySelector('.senkuro-trade-summary').classList.contains('senkuro-trade-summary--offer')).toBe(false);
  });

  it('has a style for the variant it marks', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/trade-summary.css'), 'utf8');
    expect(css).toContain('.senkuro-trade-summary--offer .senkuro-trade-summary__content');
  });
});

const userList = (name, list, collapse) => `
  <div class="card-preview-list">
    <div class="card-list"><div class="card-body"><div class="card-name"><span>${name}</span></div><div class="card-info">Отдаёт после обмена</div></div></div>
    <div class="card-preview-list__slider"><div class="card-preview-list__slider-wrap">${cardsOf(collapse ? list.slice(0, 2) : list).join('')}</div></div>
    ${collapse && list.length > 2 ? `<button class="card-preview-list-show-more">Показать ещё ${list.length - 2} карты</button>` : ''}
  </div>`;

const historyItem = (collapse) => {
  const el = document.createElement('div');
  el.className = 'card-trade';
  el.innerHTML = `${userList('Phaivroh | WL', phaivroh, collapse)}<div class="card-trade__status card-trade__status--pending">Ожидает</div>${userList('Молюсь на Sky | WS', sky, collapse)}`;
  document.body.append(el);
  return el;
};

describe('trade lists outside the modal', () => {
  it('sums a collapsed history entry from your side', () => {
    store.add({ viewerId: 'u2', items: [skyTrade] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({ sides: skySides, verdict: 'Потеря -67.6F (-78%)', grayVerdict: false });
  });

  it('names both sides and skips the verdict in somebody else history', () => {
    store.add({ viewerId: 'u9', items: [skyTrade] });
    const el = historyItem(false);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Phaivroh | WL 19F Банк 5D 4F Карты 5D 4F', 'Молюсь на Sky | WS 86.6F Банк 1.6B 4.6C 2F Карты 1B 3C 2F'],
      verdict: null,
      grayVerdict: false,
    });
    expect(el.querySelector('.senkuro-trade-summary__toggle')).toBeNull();
    expect(el.querySelector('.senkuro-trade-summary--collapsible')).toBeNull();
  });

  it('lets summaries that appear together come in one after another', () => {
    store.add({ viewerId: 'u2', items: [skyTrade] });
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map(() => historyItem(true));
    updateTradeSummaries(db, settings, store);
    const orders = items.map((item) => item.querySelector('.senkuro-trade-summary').style.getPropertyValue('--senkuro-order'));
    expect(orders).toEqual(['0', '1', '2', '3', '4', '5', '6', '6']);
  });

  it('leaves a history entry alone when the trade never reached the page', () => {
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toBeNull();
  });

  it('tells what a fast trade costs if you accept it', () => {
    store.add({
      items: [
        {
          kind: 'offer',
          id: 'o1',
          author: { id: 'u3', name: 'Smile' },
          viewerDidAuthor: false,
          offer: previews([['f-card', 1]]),
          request: previews([
            ['s-card', 1],
            ['a-card', 1],
          ]),
        },
      ],
    });
    const el = document.createElement('div');
    el.className = 'offer-card';
    el.innerHTML = `
      <div class="offer-card__top"><h3><span>Smile</span></h3><div class="offer-card__top-list">${card('s-card')}<div class="offer-card__top-more">+1</div></div></div>
      <div class="offer-card__cnt"><div class="offer-card__cnt-list">${card('f-card')}</div></div>`;
    document.body.append(el);
    updateTradeSummaries(db, settings, store);
    expect(el.querySelector('.senkuro-trade-summary__content > .senkuro-trade-summary__label').textContent).toBe('Если примешь');
    expect(summaryOf(el)).toEqual({
      sides: ['Отдаёшь 340.2F Банк 1S 1.2A Карты 1S 1A', 'Получаешь 1F Банк 1F Карты 1F'],
      verdict: 'Потеря -339.2F (-100%)',
      grayVerdict: false,
    });
  });

  it('tells what a fast trade costs when the card draws a stack copy by copy', () => {
    store.add({
      items: [
        {
          kind: 'offer',
          id: 'o2',
          author: { id: 'u4', name: 'Токунбек' },
          viewerDidAuthor: false,
          offer: previews([
            ['s-card', 1],
            ['a-card', 1],
          ]),
          request: previews([['f-card', 2]]),
        },
      ],
    });
    const el = document.createElement('div');
    el.className = 'offer-card';
    el.innerHTML = `
      <div class="offer-card__top"><h3><span>Токунбек</span></h3><div class="offer-card__top-list">${card('s-card')}<div class="offer-card__top-more">+1</div></div></div>
      <div class="offer-card__cnt"><div class="offer-card__cnt-list">${card('f-card')}${card('f-card')}</div></div>`;
    document.body.append(el);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Отдаёшь 2F Банк 2F Карты 2F', 'Получаешь 340.2F Банк 1S 1.2A Карты 1S 1A'],
      verdict: 'Выгода +338.2F (+16910%)',
      grayVerdict: false,
    });
  });

  it('stays silent on a notification two trades of the sender could explain', () => {
    store.add({ items: [skyTrade, { ...skyTrade, id: 't2', offer: [...skyTrade.offer].reverse() }] });
    const el = document.createElement('div');
    el.className = 'card-notif';
    el.innerHTML = `
      <div class="card-notif__source-title">Phaivroh | WL</div>
      <div class="card-notif__info"><div class="card-notif__info-hint">Получишь 4 • Отдашь 5</div></div>`;
    document.body.append(el);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toBeNull();
  });

  it('sums a trade notification by its sender and counters', () => {
    store.add({ items: [skyTrade] });
    const el = document.createElement('div');
    el.className = 'card-notif';
    el.innerHTML = `
      <div class="card-notif__source-title">Phaivroh | WL</div>
      <div class="card-notif__info"><div class="card-notif__info-caption">Хочет обменяться картами</div><div class="card-notif__info-hint">Получишь 4 • Отдашь 5</div></div>`;
    document.body.append(el);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({ sides: skySides, verdict: 'Потеря -67.6F (-78%)', grayVerdict: false });
  });
});

describe('trade time', () => {
  const sent = new Date(2026, 9, 17, 23, 31, 5);
  const sentAt = `${sent.toISOString().slice(0, -1)}657`;
  const sentText = 'Отправлен 17.10.26, 23:31';
  const timed = { ...skyTrade, createdAt: sentAt };
  const timeOf = (el) => el.querySelector('.senkuro-trade-summary__time');
  const notification = () => {
    const el = document.createElement('div');
    el.className = 'card-notif';
    el.innerHTML = `
      <div class="card-notif__source-title">Phaivroh | WL</div>
      <div class="card-notif__info"><div class="card-notif__info-hint">Получишь 4 • Отдашь 5</div></div>`;
    document.body.append(el);
    return el;
  };

  it('tells when an incoming trade was sent', () => {
    store.add({ viewerId: 'u2', items: [timed] });
    const el = modal(
      'Прими решение обмена',
      reviewBody(panel('Phaivroh | WL', 4, cardsOf(phaivroh)), panel('Молюсь на Sky | WS', 5, cardsOf(sky))) + reviewFooter
    );
    updateTradeSummaries(db, settings, store);
    expect(timeOf(el).textContent).toBe(sentText);
    expect(timeOf(el).getAttribute('datetime')).toBe(sent.toISOString());
  });

  it('tells when a history entry was sent and keeps the time out of the folding table', () => {
    store.add({ viewerId: 'u2', items: [timed] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(timeOf(el).textContent).toBe(sentText);
    expect(timeOf(el).closest('.senkuro-trade-summary__details')).toBeNull();
  });

  it('leaves the time out when identical trades were sent at different times', () => {
    store.add({ viewerId: 'u2', items: [timed, { ...timed, id: 't2', createdAt: '2026-10-16T08:00:00.000001' }] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).toEqual({ sides: skySides, verdict: 'Потеря -67.6F (-78%)', grayVerdict: false });
    expect(timeOf(el)).toBeNull();
  });

  it('leaves the time to a notification, which shows its own date', () => {
    store.add({ items: [timed] });
    const el = notification();
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).not.toBeNull();
    expect(timeOf(el)).toBeNull();
  });

  it('adds the time to a summary already drawn once the time arrives', () => {
    store.add({ viewerId: 'u2', items: [skyTrade] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(timeOf(el)).toBeNull();
    store.add({ items: [timed] });
    updateTradeSummaries(db, settings, store);
    expect(timeOf(el).textContent).toBe(sentText);
  });
});

describe('card that left in another trade', () => {
  const local = (date) => date.toISOString().slice(0, -1);
  const rejected = { ...skyTrade, status: 'REJECTED', createdAt: local(new Date(2026, 9, 15, 12, 9)) };
  const accepted = {
    kind: 'trade',
    id: 't9',
    status: 'ACCEPTED',
    createdAt: local(new Date(2026, 9, 15, 13, 31)),
    source: { id: 'u1', name: 'Phaivroh | WL' },
    destination: { id: 'u3', name: 'Laminat' },
    offer: previews([['atiss', 1]]),
    request: previews([['kan', 1]]),
  };
  const departureOf = (el) => el.querySelector('.senkuro-trade-summary__departure')?.textContent ?? null;

  it('names the card, who gave it to whom and when under a rejected history entry', () => {
    store.add({ viewerId: 'u2', items: [rejected, accepted] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(departureOf(el)).toBe('Карта «Атисс» ушла от Phaivroh | WL к Laminat в обмене от 15.10.26, 13:31');
    expect(el.querySelector('.senkuro-trade-summary__departure').closest('.senkuro-trade-summary__details')).toBeNull();
  });

  it('says nothing when no accepted trade took a card of the rejected one', () => {
    store.add({ viewerId: 'u2', items: [rejected, { ...accepted, offer: previews([['gran', 1]]) }] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(summaryOf(el)).not.toBeNull();
    expect(departureOf(el)).toBeNull();
  });

  it('adds the line once the accepted trade comes with a later page of the history', () => {
    store.add({ viewerId: 'u2', items: [rejected] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(departureOf(el)).toBeNull();
    store.add({ items: [accepted] });
    updateTradeSummaries(db, settings, store);
    expect(departureOf(el)).toContain('«Атисс»');
  });

  it('says nothing under a trade that was not rejected', () => {
    store.add({ viewerId: 'u2', items: [{ ...rejected, status: 'PENDING' }, accepted] });
    const el = historyItem(true);
    updateTradeSummaries(db, settings, store);
    expect(departureOf(el)).toBeNull();
  });
});

describe('isTradeMutation', () => {
  const recordsOf = (act) => {
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    act();
    const records = observer.takeRecords();
    observer.disconnect();
    return records;
  };

  const fastTrade = () => {
    const el = document.createElement('div');
    el.className = 'offer-card';
    el.innerHTML = `
      <div class="offer-card__top"><h3><span>Smile</span></h3><div class="offer-card__top-list">${card('s-card')}</div></div>
      <div class="offer-card__cnt"><div class="offer-card__cnt-list">${card('f-card')}</div></div>`;
    return el;
  };

  it('notices a fast trade card drawn into a list', () => {
    const list = document.createElement('div');
    document.body.append(list);
    expect(recordsOf(() => list.append(fastTrade())).some(isTradeMutation)).toBe(true);
  });

  it('notices a trade window that opens', () => {
    expect(recordsOf(() => modal('Прими решение обмена', reviewFooter)).some(isTradeMutation)).toBe(true);
  });

  it('notices new counters on a notification, which draws no cards', () => {
    const el = document.createElement('div');
    el.className = 'card-notif';
    el.innerHTML = '<div class="card-notif__info"><div class="card-notif__info-hint">Получишь 4 • Отдашь 5</div></div>';
    document.body.append(el);
    const hint = el.querySelector('.card-notif__info-hint').firstChild;
    expect(recordsOf(() => (hint.data = 'Получишь 2 • Отдашь 1')).some(isTradeMutation)).toBe(true);
  });

  it('ignores cards drawn anywhere else', () => {
    const list = document.createElement('div');
    document.body.append(list);
    expect(recordsOf(() => (list.innerHTML = card('s-card'))).some(isTradeMutation)).toBe(false);
  });

  it('ignores the summaries it draws itself, so a second pass changes nothing', () => {
    store.add({
      items: [
        {
          kind: 'offer',
          id: 'o1',
          author: { id: 'u3', name: 'Smile' },
          viewerDidAuthor: false,
          offer: previews([['f-card', 1]]),
          request: previews([['s-card', 1]]),
        },
      ],
    });
    const el = fastTrade();
    document.body.append(el);
    const first = recordsOf(() => updateTradeSummaries(db, settings, store));
    expect(summaryOf(el)).not.toBeNull();
    expect(first.some(isTradeMutation)).toBe(false);
    expect(recordsOf(() => updateTradeSummaries(db, settings, store))).toEqual([]);
  });
});
