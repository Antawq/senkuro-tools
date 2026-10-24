import { beforeEach, describe, expect, it } from 'vitest';

import { createPriceBadges } from '../utils/badges/price-badges';
import { visibleName } from '../utils/shared/copy-button';
import { DEFAULT_SETTINGS } from '../utils/shared/settings';

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

const render = (html: string) => {
  document.body.innerHTML = html;
  createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS);
};

beforeEach(() => document.body.replaceChildren());

const AXIS_X = {
  left: { '--s-left': '5px', '--s-align': 'left' },
  center: { '--s-left': '50%', '--s-tx': '-50%', '--s-align': 'center' },
  right: { '--s-right': '5px', '--s-align': 'right' },
};
const AXIS_Y = {
  top: { '--s-top': '5px' },
  center: { '--s-top': '50%', '--s-ty': '-50%', '--s-mt': '0px' },
  bottom: { '--s-bottom': '5px' },
};
const POSITION_PROPS = ['--s-top', '--s-bottom', '--s-left', '--s-right', '--s-mt', '--s-tx', '--s-ty', '--s-align'];

const positionVars = (el: HTMLElement): Record<string, string> =>
  Object.fromEntries(POSITION_PROPS.map((prop): [string, string] => [prop, el.style.getPropertyValue(prop)]).filter(([, value]) => value));

const holderOf = () => document.querySelector('.card-collect-preview') as HTMLElement;

describe('createPriceBadges', () => {
  it('prices a card once and leaves its flip side alone', () => {
    render(preview());
    const holders = [...document.querySelectorAll('[data-senkuro-price]')];
    expect(holders).toHaveLength(1);
    expect(holders[0]?.matches('.card-collect-preview')).toBe(true);
    expect(holders[0]?.getAttribute('data-senkuro-price')).toBe('1.00');
  });

  it('keeps the chosen corner on ordinary cards', () => {
    render(preview());
    expect(holderOf().dataset.badgePos).toBe(`${DEFAULT_SETTINGS.positionX}-${DEFAULT_SETTINGS.positionY}`);
  });

  it.each((Object.keys(AXIS_X) as (keyof typeof AXIS_X)[]).flatMap((x) => (Object.keys(AXIS_Y) as (keyof typeof AXIS_Y)[]).map((y) => [x, y] as const)))(
    'places the badge at %s %s',
    (x, y) => {
      document.body.innerHTML = preview();
      createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, positionX: x, positionY: y });
      expect(holderOf().dataset.badgePos).toBe(`${x}-${y}`);
      expect(positionVars(holderOf())).toEqual({ ...AXIS_X[x], ...AXIS_Y[y] });
    }
  );

  it('moves the badge when the position changes', () => {
    document.body.innerHTML = preview();
    const badges = createPriceBadges({ touch: false });
    badges.update(db, DEFAULT_SETTINGS);
    badges.reset();
    badges.update(db, { ...DEFAULT_SETTINGS, positionX: 'left', positionY: 'top' });
    expect(holderOf().dataset.badgePos).toBe('left-top');
    expect(positionVars(holderOf())).toEqual({ ...AXIS_X.left, ...AXIS_Y.top });
  });

  it.each([
    ['center', 'bottom', '-50% 0'],
    ['right', 'center', '0 -50%'],
    ['left', 'top', '0 0'],
  ] as const)('centres the copy button by its own size next to a %s %s badge', (positionX, positionY, translate) => {
    document.body.innerHTML = preview();
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true, positionX, positionY });
    const button = holderOf().querySelector('.senkuro-copy-btn') as HTMLElement;
    expect(button.style.getPropertyValue('translate')).toBe(translate);
  });

  it.each([
    ['top', 'bottom'],
    ['center', 'top'],
    ['bottom', 'top'],
  ] as const)('keeps the copy button clear of a badge centred at the %s by moving it to the %s edge', (badgeY, edge) => {
    document.body.innerHTML = preview();
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true, positionX: 'center', positionY: badgeY });
    const button = holderOf().querySelector('.senkuro-copy-btn') as HTMLElement;
    expect([button.style.left, button.style.top, button.style.bottom]).toEqual(['50%', edge === 'top' ? '5px' : 'auto', edge === 'bottom' ? '5px' : 'auto']);
  });

  const stacked = (cls: string, layer: number) =>
    preview().replace('class="card-collect-preview"', `class="card-collect-preview ${cls}" style="z-index: ${layer}"`);
  const fan = (layers: number[]) =>
    `<div class="modal-trade__swap-cards">${layers.map((layer) => stacked('modal-trade__card', layer)).join('')}<div class="modal-trade__swap-tag" style="z-index: 4"></div></div>`;
  const offerList = (cards: number, more: boolean) =>
    `<div class="offer-card__cnt-list">${stacked('offer-card__cnt-el', 2).repeat(cards)}${more ? '<div class="offer-card__cnt-el offer-card__cnt-el-more" style="z-index: 4">+6</div>' : ''}</div>`;
  const positions = () => [...document.querySelectorAll<HTMLElement>('.card-collect-preview')].map((holder) => holder.dataset.badgePos);

  it('follows the chosen position on a trade fan card that nothing covers', () => {
    document.body.innerHTML = fan([2]);
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, positionX: 'center', positionY: 'top' });
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
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect([...document.querySelectorAll<HTMLElement>('.senkuro-copy-btn')].map((button) => button.dataset.btnPos)).toEqual(['left-bottom', 'right-bottom']);
  });

  it.each([
    ['bottom', '--s-bottom', 'calc(5px + 20px)'],
    ['center', '--s-mt', '-10px'],
    ['top', '--s-top', '5px'],
  ] as const)('measures the %s position from the card art, not from a taller card box', (positionY, prop, value) => {
    document.body.innerHTML = fan([2]);
    const root = holderOf();
    const face = root.querySelector('.card-collect-preview__flip-container') as HTMLElement;
    Object.defineProperty(root, 'offsetHeight', { value: 170 });
    Object.defineProperties(face, { offsetParent: { value: root }, offsetTop: { value: 0 }, offsetHeight: { value: 150 } });
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, positionY, copyBtn: true });
    expect(root.style.getPropertyValue(prop)).toBe(value);
    const button = root.querySelector('.senkuro-copy-btn') as HTMLElement;
    expect(positionY === 'center' ? button.style.marginTop : button.style[positionY]).toBe(value);
  });

  it('copies a card name without the invisible characters some names carry', () => {
    expect(visibleName('Элия\u200b Крисанакс')).toBe('Элия Крисанакс');
    expect(visibleName('\u200eСоран\u200b ')).toBe('Соран');
    document.body.innerHTML = preview();
    createPriceBadges({ touch: false }).update({ soran: { ...db.soran, name: 'Со\u200bран' } }, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect((document.querySelector('.senkuro-copy-btn') as HTMLElement).dataset.charName).toBe('Соран');
  });

  it('prices card immediately even before its image loads or without img src', () => {
    document.body.innerHTML = `
      <div class="card-collect-preview">
        <div class="card-collect-preview__front"><a class="card-collect" href="/cards/soran"><img></a></div>
      </div>`;
    createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS);
    expect(holderOf().getAttribute('data-senkuro-price')).toBe('1.00');
  });

  const renderAtWidth = (width: number) => {
    document.body.innerHTML = preview();
    for (const link of document.querySelectorAll('a.card-collect')) Object.defineProperty(link, 'offsetWidth', { value: width });
    createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS);
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
    const holder = document.querySelector<HTMLElement>('[data-senkuro-price]');
    expect(holder?.getAttribute('data-senkuro-price')).toBe('1.00');
    expect(Number.parseFloat(holder?.style.getPropertyValue('--s-size') ?? '')).toBeLessThan(DEFAULT_SETTINGS.fontSize);
  });

  it('prices only the provided batch of cards when specified', () => {
    document.body.innerHTML = `
      <div id="c1" class="card-collect-preview"><div class="card-collect-preview__front"><a class="card-collect" href="/cards/soran"></a></div></div>
      <div id="c2" class="card-collect-preview"><div class="card-collect-preview__front"><a class="card-collect" href="/cards/soran"></a></div></div>`;
    const card1 = document.querySelector('#c1 a.card-collect') as HTMLAnchorElement;
    createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS, [card1]);
    expect(document.querySelector('#c1')?.getAttribute('data-senkuro-price')).toBe('1.00');
    expect(document.querySelector('#c2')?.hasAttribute('data-senkuro-price')).toBe(false);
  });

  describe('with the prices switched off', () => {
    const pricesOff = { ...DEFAULT_SETTINGS, showBadges: false };

    it('draws no price and leaves the card element as the site made it', () => {
      document.body.innerHTML = preview();
      createPriceBadges({ touch: false }).update(db, pricesOff);
      expect(document.querySelector('[data-senkuro-price]')).toBeNull();
      expect(document.querySelector('.senkuro-copy-btn')).toBeNull();
      expect(holderOf().hasAttribute('style')).toBe(false);
      expect(holderOf().dataset.badgePos).toBeUndefined();
    });

    it('still gives the copy button when it is switched on', () => {
      document.body.innerHTML = preview();
      createPriceBadges({ touch: false }).update(db, { ...pricesOff, copyBtn: true });
      expect(document.querySelector('[data-senkuro-price]')).toBeNull();
      expect((document.querySelector('.senkuro-copy-btn') as HTMLElement).dataset.charName).toBe('Соран');
    });

    it('takes the prices off and puts them back when the setting changes, as the page does it', () => {
      document.body.innerHTML = preview();
      const badges = createPriceBadges({ touch: false });
      badges.update(db, DEFAULT_SETTINGS);
      expect(holderOf().getAttribute('data-senkuro-price')).toBe('1.00');
      badges.reset();
      badges.update(db, pricesOff);
      expect(document.querySelector('[data-senkuro-price]')).toBeNull();
      badges.reset();
      badges.update(db, DEFAULT_SETTINGS);
      expect(holderOf().getAttribute('data-senkuro-price')).toBe('1.00');
    });
  });
});
