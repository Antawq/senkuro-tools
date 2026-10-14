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

const AXIS_X = {
  left: { '--s-left': '5px', '--s-align': 'left' },
  center: { '--s-left': '50%', '--s-ml': '-15px', '--s-align': 'center' },
  right: { '--s-right': '5px', '--s-align': 'right' },
};
const AXIS_Y = {
  top: { '--s-top': '5px' },
  center: { '--s-top': '50%', '--s-mt': '-12px' },
  bottom: { '--s-bottom': '5px' },
};
const POSITION_PROPS = ['--s-top', '--s-bottom', '--s-left', '--s-right', '--s-mt', '--s-ml', '--s-align'];

const positionVars = (el) => Object.fromEntries(POSITION_PROPS.map((prop) => [prop, el.style.getPropertyValue(prop)]).filter(([, value]) => value));

describe('createPriceBadges', () => {
  it('prices a card once and leaves its flip side alone', () => {
    render(preview());
    const holders = [...document.querySelectorAll('[data-senkuro-price]')];
    expect(holders).toHaveLength(1);
    expect(holders[0].matches('.card-collect-preview')).toBe(true);
    expect(holders[0].getAttribute('data-senkuro-price')).toBe('1.00');
  });

  it('keeps the chosen corner on ordinary cards', () => {
    render(preview());
    const holder = document.querySelector('.card-collect-preview');
    expect(holder.dataset.badgePos).toBe(`${DEFAULT_SETTINGS.positionX}-${DEFAULT_SETTINGS.positionY}`);
  });

  it.each(Object.keys(AXIS_X).flatMap((x) => Object.keys(AXIS_Y).map((y) => [x, y])))('places the badge at %s %s', (x, y) => {
    document.body.innerHTML = preview();
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, { ...DEFAULT_SETTINGS, positionX: x, positionY: y });
    const holder = document.querySelector('.card-collect-preview');
    expect(holder.dataset.badgePos).toBe(`${x}-${y}`);
    expect(positionVars(holder)).toEqual({ ...AXIS_X[x], ...AXIS_Y[y] });
  });

  it('moves the badge when the position changes', () => {
    document.body.innerHTML = preview();
    const badges = createPriceBadges({ onImageLoad: () => {}, touch: false });
    badges.update(db, DEFAULT_SETTINGS);
    badges.reset();
    badges.update(db, { ...DEFAULT_SETTINGS, positionX: 'left', positionY: 'top' });
    const holder = document.querySelector('.card-collect-preview');
    expect(holder.dataset.badgePos).toBe('left-top');
    expect(positionVars(holder)).toEqual({ ...AXIS_X.left, ...AXIS_Y.top });
  });

  it('moves the price to the left edge in the trade fan where the next card covers the right one', () => {
    render(`<div class="modal-trade__swap-cards">${preview()}${preview()}${preview()}</div>`);
    const holders = [...document.querySelectorAll('.card-collect-preview')];
    expect(holders.map((holder) => holder.dataset.badgePos)).toEqual(['left-center', 'left-center', 'left-center']);
    expect(holders[0].style.getPropertyValue('--s-left')).toBe('5px');
    expect(holders[0].style.getPropertyValue('--s-right')).toBe('');
    expect(document.querySelectorAll('[data-senkuro-price]')).toHaveLength(3);
  });

  it('overrides the chosen corner in the trade fan', () => {
    document.body.innerHTML = `<div class="modal-trade__swap-cards">${preview()}</div>`;
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, { ...DEFAULT_SETTINGS, positionX: 'center', positionY: 'top' });
    expect(document.querySelector('.card-collect-preview').dataset.badgePos).toBe('left-center');
  });

  it('puts the copy button on the same edge as the badge in the trade fan', () => {
    document.body.innerHTML = `<div class="modal-trade__swap-cards">${preview()}</div>`;
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect(document.querySelector('.senkuro-copy-btn').dataset.btnPos).toBe('left-center');
  });

  it('prices card immediately even before its image loads or without img src', () => {
    document.body.innerHTML = `
      <div class="card-collect-preview">
        <div class="card-collect-preview__front"><a class="card-collect" href="/cards/soran"><img></a></div>
      </div>`;
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, DEFAULT_SETTINGS);
    const holder = document.querySelector('.card-collect-preview');
    expect(holder.getAttribute('data-senkuro-price')).toBe('1.00');
  });

  it('prices only the provided batch of cards when specified', () => {
    document.body.innerHTML = `
      <div id="c1" class="card-collect-preview"><div class="card-collect-preview__front"><a class="card-collect" href="/cards/soran"></a></div></div>
      <div id="c2" class="card-collect-preview"><div class="card-collect-preview__front"><a class="card-collect" href="/cards/soran"></a></div></div>`;
    const [card1] = document.querySelectorAll('a.card-collect');
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, DEFAULT_SETTINGS, [card1]);
    expect(document.querySelector('#c1').getAttribute('data-senkuro-price')).toBe('1.00');
    expect(document.querySelector('#c2').hasAttribute('data-senkuro-price')).toBe(false);
  });
});
