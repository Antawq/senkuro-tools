import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REPLAY_EVENT, createTradeStore } from '../utils/trade-capture';
import { updateTradeSummaries } from '../utils/trade-summary';

const db = {
  's-card': { price: 1.25, rank: 'S' },
  'a-card': { price: 1.5, rank: 'A' },
  'f-card': { price: 1.25, rank: 'F' },
  atiss: { price: 1.25, rank: 'D' },
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
const skySides = ['Получаешь 19F банк 5D 4F карты 5D 4F', 'Отдаёшь 86.6F банк 1.6B 4.6C 2F карты 1B 3C 2F'];

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
    <div class="modal-trade__footer-info">После отправки карты изменить не получится</div>
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
          ...body.map(([label, ...values]) => `${label.textContent === 'ценность' ? '' : `${label.textContent} `}${values[index].textContent}`),
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
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Получаешь 194.4F банк 2.4A карты 2A', 'Отдаёшь 243F банк 1S карты 1S'],
      verdict: 'Потеря -48.6F (-20%)',
      grayVerdict: false,
    });
  });

  it('keeps the exact selection on the own review step where only three cards per side are drawn', () => {
    const offers = [card('s-card'), card('s-card'), card('s-card'), card('f-card'), card('f-card')];
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card')], offers));
    updateTradeSummaries(db, { commission: true }, store);
    el.querySelector('.modal-trade__footer').remove();
    el.insertAdjacentHTML('beforeend', reviewBody(panel('Я', 5, offers), panel('Он', 1, [card('a-card')])) + reviewFooter);
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el).sides).toEqual(['Отдаёшь 731F банк 3S 2F карты 3S 2F', 'Получаешь 97.2F банк 1.2A карты 1A']);
  });

  it('drops a remembered selection that no longer matches the drawn cards', () => {
    const offers = [card('s-card'), card('s-card'), card('s-card'), card('f-card'), card('f-card')];
    const el = modal('Выбери до 50 карт', constructorFooter([card('a-card')], offers));
    updateTradeSummaries(db, { commission: true }, store);
    el.querySelector('.modal-trade__footer').remove();
    const drawn = [card('s-card', 2), card('s-card'), card('s-card')];
    el.insertAdjacentHTML('beforeend', reviewBody(panel('Я', 5, drawn), panel('Он', 1, [card('a-card')])) + reviewFooter);
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el).sides[0]).toBe('Отдаёшь 972F банк 4S 2X карты 4S 2X');
  });

  it('asks the page for the trades again once when an incoming trade has no data', () => {
    const asked = vi.fn();
    document.addEventListener(REPLAY_EVENT, asked);
    const el = modal('Прими решение обмена', reviewBody(panel('Отправитель', 6, [card('s-card')]), panel('Я', 1, [card('s-card')])) + reviewFooter);
    updateTradeSummaries(db, { commission: true }, store);
    updateTradeSummaries(db, { commission: true }, store);
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
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el).sides).toEqual([skySides[0], 'Отдаёшь 63F банк 1.6B 2.2C 2X карты 1B 2C 2X']);
  });

  it('marks the cards an incoming trade does not draw as gray X', () => {
    const offers = [card('s-card'), card('s-card'), card('f-card')];
    const el = modal('Прими решение обмена', reviewBody(panel('Отправитель', 6, offers), panel('Я', 1, [card('s-card')])) + reviewFooter);
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Получаешь 487F банк 2S 1F 3X карты 2S 1F 3X', 'Отдаёшь 243F банк 1S карты 1S'],
      verdict: 'Выгода +244F (+100%)',
      grayVerdict: true,
    });
    expect(el.querySelector('.senkuro-trade-summary__cell strong.senkuro-trade-summary__unknown').textContent).toBe('487F');
  });

  it('takes the whole incoming trade from the site responses instead of gray X', () => {
    store.add({ viewerId: 'u2', items: [skyTrade] });
    const el = modal(
      'Прими решение обмена',
      reviewBody(panel('Phaivroh | WL', 4, cardsOf(phaivroh)), panel('Молюсь на Sky | WS', 5, cardsOf(sky))) + reviewFooter
    );
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toEqual({ sides: skySides, verdict: 'Потеря -67.6F (-78%)', grayVerdict: false });
  });

  it('shows shards as their own line outside F, bank and cards', () => {
    const el = modal('', constructorFooter([card('s-card', 5, true), card('a-card')], [card('missing')]));
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Получаешь 97.2F банк 1.2A карты 1A осколки 5S · 1215F', 'Отдаёшь 0F банк 1X карты 1X осколки -'],
      verdict: 'Выгода +97.2F',
      grayVerdict: true,
    });
    const shardLine = el.querySelector('.senkuro-trade-summary__verdict--shards');
    expect(shardLine.textContent).toBe('Осколки: Выгода +1215F');
    expect(shardLine.classList.contains('senkuro-trade-summary__verdict--gain')).toBe(true);
  });

  it('stays away from the forge, which has no trade partner', () => {
    const el = modal(
      'Выбери 3 одинаковые карты',
      `<div class="modal-trade__footer"><div class="modal-trade__preview"><div class="modal-trade__preview-el"><div class="modal-trade__preview-list">${card('s-card')}</div></div></div></div>`
    );
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toBeNull();
  });

  it('folds the summary when every card is unselected and unfolds the same block again', () => {
    const el = modal('', constructorFooter([card('a-card')], [card('s-card')]));
    updateTradeSummaries(db, { commission: true }, store);
    const summary = el.querySelector('.senkuro-trade-summary');
    const lists = el.querySelectorAll('.modal-trade__preview-cnt');
    lists.forEach((list) => list.replaceChildren());
    updateTradeSummaries(db, { commission: true }, store);
    expect(summary.classList.contains('senkuro-trade-summary--closed')).toBe(true);
    lists[1].insertAdjacentHTML('beforeend', card('f-card'));
    updateTradeSummaries(db, { commission: true }, store);
    expect(el.querySelector('.senkuro-trade-summary')).toBe(summary);
    expect(summary.classList.contains('senkuro-trade-summary--closed')).toBe(false);
    expect(summaryOf(el).sides[1]).toBe('Отдаёшь 1F банк 1F карты 1F');
  });

  it('hides the table behind a toggle that keeps its state across redraws', () => {
    const el = modal('', constructorFooter([card('a-card')], [card('s-card')]));
    updateTradeSummaries(db, { commission: true }, store);
    const summary = el.querySelector('.senkuro-trade-summary');
    const toggle = () => summary.querySelector('.senkuro-trade-summary__toggle');
    expect(summary.classList.contains('senkuro-trade-summary--collapsible')).toBe(true);
    expect([toggle().textContent, toggle().getAttribute('aria-expanded')]).toEqual(['Раскрыть полностью', 'false']);
    let bubbled = false;
    el.addEventListener('click', () => (bubbled = true));
    toggle().click();
    expect(bubbled).toBe(false);
    expect(summary.classList.contains('senkuro-trade-summary--expanded')).toBe(true);
    el.querySelectorAll('.modal-trade__preview-cnt')[1].insertAdjacentHTML('beforeend', card('f-card'));
    updateTradeSummaries(db, { commission: true }, store);
    expect([toggle().textContent, toggle().getAttribute('aria-expanded')]).toEqual(['Скрыть', 'true']);
  });

  it('does not touch the summary when nothing changed', () => {
    const el = modal('', constructorFooter([card('a-card')], [card('s-card')]));
    updateTradeSummaries(db, { commission: true }, store);
    const first = el.querySelector('.senkuro-trade-summary__table');
    const content = el.querySelector('.senkuro-trade-summary__content');
    updateTradeSummaries(db, { commission: true }, store);
    expect(el.querySelector('.senkuro-trade-summary__table')).toBe(first);
    updateTradeSummaries(db, { commission: false }, store);
    expect(el.querySelector('.senkuro-trade-summary__table')).not.toBe(first);
    updateTradeSummaries(db, { commission: false, valueBySplit: true }, store);
    expect(summaryOf(el).sides).toEqual(['Получаешь 24F банк 1.5A карты 1A', 'Отдаёшь 40F банк 1.25S карты 1S']);
    expect(el.querySelector('.senkuro-trade-summary__content')).toBe(content);
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
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toEqual({ sides: skySides, verdict: 'Потеря -67.6F (-78%)', grayVerdict: false });
  });

  it('names both sides and skips the verdict in somebody else history', () => {
    store.add({ viewerId: 'u9', items: [skyTrade] });
    const el = historyItem(false);
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toEqual({
      sides: ['Phaivroh | WL 19F банк 5D 4F карты 5D 4F', 'Молюсь на Sky | WS 86.6F банк 1.6B 4.6C 2F карты 1B 3C 2F'],
      verdict: null,
      grayVerdict: false,
    });
    expect(el.querySelector('.senkuro-trade-summary__toggle')).toBeNull();
    expect(el.querySelector('.senkuro-trade-summary--collapsible')).toBeNull();
  });

  it('lets summaries that appear together come in one after another', () => {
    store.add({ viewerId: 'u2', items: [skyTrade] });
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map(() => historyItem(true));
    updateTradeSummaries(db, { commission: true }, store);
    const orders = items.map((item) => item.querySelector('.senkuro-trade-summary').style.getPropertyValue('--senkuro-order'));
    expect(orders).toEqual(['0', '1', '2', '3', '4', '5', '6', '6']);
  });

  it('leaves a history entry alone when the trade never reached the page', () => {
    const el = historyItem(true);
    updateTradeSummaries(db, { commission: true }, store);
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
    updateTradeSummaries(db, { commission: true }, store);
    expect(el.querySelector('.senkuro-trade-summary__content > .senkuro-trade-summary__label').textContent).toBe('Если примешь');
    expect(summaryOf(el)).toEqual({
      sides: ['Отдаёшь 340.2F банк 1S 1.2A карты 1S 1A', 'Получаешь 1F банк 1F карты 1F'],
      verdict: 'Потеря -339.2F (-100%)',
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
    updateTradeSummaries(db, { commission: true }, store);
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
    updateTradeSummaries(db, { commission: true }, store);
    expect(summaryOf(el)).toEqual({ sides: skySides, verdict: 'Потеря -67.6F (-78%)', grayVerdict: false });
  });
});
