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

  const stacked = (cls, layer) => preview().replace('class="card-collect-preview"', `class="card-collect-preview ${cls}" style="z-index: ${layer}"`);
  const fan = (layers) =>
    `<div class="modal-trade__swap-cards">${layers.map((layer) => stacked('modal-trade__card', layer)).join('')}<div class="modal-trade__swap-tag" style="z-index: 4"></div></div>`;
  const offerList = (cards, more) =>
    `<div class="offer-card__cnt-list">${stacked('offer-card__cnt-el', 2).repeat(cards)}${more ? '<div class="offer-card__cnt-el offer-card__cnt-el-more" style="z-index: 4">+6</div>' : ''}</div>`;
  const positions = () => [...document.querySelectorAll('.card-collect-preview')].map((holder) => holder.dataset.badgePos);

  it('follows the chosen position on a trade fan card that nothing covers', () => {
    document.body.innerHTML = fan([2]);
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, { ...DEFAULT_SETTINGS, positionX: 'center', positionY: 'top' });
    expect(positions()).toEqual(['center-top']);
  });

  it('moves only the covered trade fan cards to their visible left edge and keeps the chosen height', () => {
    render(fan([2, 1, 3]));
    expect(positions()).toEqual(['left-bottom', 'left-bottom', 'right-bottom']);
    render(fan([2, 1]));
    expect(positions()).toEqual(['right-bottom', 'left-bottom']);
  });

  it('moves every offer card but the last to its visible left edge', () => {
    render(offerList(2, false));
    expect(positions()).toEqual(['left-bottom', 'right-bottom']);
  });

  it('treats the card under the "+N" tile of an offer as covered too', () => {
    render(offerList(3, true));
    expect(positions()).toEqual(['left-bottom', 'left-bottom', 'left-bottom']);
  });

  it('puts the copy button on the same edge as the badge of a covered card', () => {
    document.body.innerHTML = offerList(2, false);
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect([...document.querySelectorAll('.senkuro-copy-btn')].map((button) => button.dataset.btnPos)).toEqual(['left-bottom', 'right-bottom']);
  });

  it.each([
    ['bottom', '--s-bottom', 'calc(5px + 20px)'],
    ['center', '--s-mt', 'calc(-12px + -10px)'],
    ['top', '--s-top', '5px'],
  ])('measures the %s position from the card art, not from a taller card box', (positionY, prop, value) => {
    document.body.innerHTML = fan([2]);
    const root = document.querySelector('.card-collect-preview');
    const face = root.querySelector('.card-collect-preview__flip-container');
    Object.defineProperty(root, 'offsetHeight', { value: 170 });
    Object.defineProperties(face, { offsetParent: { value: root }, offsetTop: { value: 0 }, offsetHeight: { value: 150 } });
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, { ...DEFAULT_SETTINGS, positionY, copyBtn: true });
    expect(root.style.getPropertyValue(prop)).toBe(value);
    const button = root.querySelector('.senkuro-copy-btn');
    expect(positionY === 'center' ? button.style.marginTop : button.style[positionY]).toBe(value);
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

  const renderAtWidth = (width) => {
    document.body.innerHTML = preview();
    for (const link of document.querySelectorAll('a.card-collect')) Object.defineProperty(link, 'offsetWidth', { value: width });
    createPriceBadges({ onImageLoad: () => {}, touch: false }).update(db, DEFAULT_SETTINGS);
  };

  it('leaves a thumbnail too narrow for a readable price without one', () => {
    renderAtWidth(24);
    expect(document.querySelector('[data-senkuro-price]')).toBeNull();
  });

  it('prices the 36px cards of notifications', () => {
    renderAtWidth(36);
    expect(document.querySelector('[data-senkuro-price]')?.getAttribute('data-senkuro-price')).toBe('1.00');
  });

  it('still prices a small card that has room for the price, in a smaller font', () => {
    renderAtWidth(50);
    const holder = document.querySelector('[data-senkuro-price]');
    expect(holder?.getAttribute('data-senkuro-price')).toBe('1.00');
    expect(Number.parseFloat(holder?.style.getPropertyValue('--s-size') ?? '')).toBeLessThan(DEFAULT_SETTINGS.fontSize);
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
