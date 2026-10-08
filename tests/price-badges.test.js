import { beforeEach, describe, expect, it } from 'vitest';

import { createPriceBadges } from '../utils/price-badges';
import { DEFAULT_SETTINGS } from '../utils/settings';

const db = { soran: { price: 1.25, name: 'Соран', rank: 'F' } };
const image = 'https://shiro.senkuro.net/cards/soran.webp';

const preview = () => `
  <div class="card-collect-preview">
    <div class="card-collect-preview__status"></div>
    <div class="card-collect-preview__flip-container">
      <div class="card-collect-preview__front"><a class="card-collect" href="/cards/soran"><img src="${image}"></a></div>
      <div class="card-collect-preview__back"><a class="card-collect" href="/cards/soran"><img src="${image}"></a></div>
    </div>
  </div>`;

const render = (html) => {
  document.body.innerHTML = html;
  createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, DEFAULT_SETTINGS);
};

beforeEach(() => document.body.replaceChildren());

describe('createPriceBadges', () => {
  it('prices the face of a card and leaves its flip side alone', () => {
    render(preview());
    const holders = [...document.querySelectorAll('[data-senkuro-price]')];
    expect(holders).toHaveLength(1);
    expect(holders[0].matches('.card-collect-preview__front')).toBe(true);
    expect(holders[0].getAttribute('data-senkuro-price')).toBe('1.00');
  });

  it('keeps the chosen corner on ordinary cards', () => {
    render(preview());
    const front = document.querySelector('.card-collect-preview__front');
    expect(front.dataset.badgePos).toBe(DEFAULT_SETTINGS.position);
  });

  it('moves the price to the left edge in the trade fan where the next card covers the right one', () => {
    render(`<div class="modal-trade__swap-cards">${preview()}${preview()}${preview()}</div>`);
    const fronts = [...document.querySelectorAll('.card-collect-preview__front')];
    expect(fronts.map((front) => front.dataset.badgePos)).toEqual(['center-left', 'center-left', 'center-left']);
    expect(fronts[0].style.getPropertyValue('--s-left')).toBe('5px');
    expect(fronts[0].style.getPropertyValue('--s-right')).toBe('');
    expect(document.querySelectorAll('[data-senkuro-price]')).toHaveLength(3);
  });
});
