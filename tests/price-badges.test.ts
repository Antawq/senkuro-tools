import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPriceBadges } from '../utils/badges/price-badges';
import { APP_MOUNTED_ATTRIBUTE } from '../utils/shared/app-mounted';
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

beforeEach(() => {
  document.body.replaceChildren();
  document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
});
afterEach(() => {
  document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

  it('prices a shard row with the price of its whole card, the price the price sort orders it by', () => {
    render(preview().replace('class="card-collect-preview"', 'class="card-collect-preview card-collect-preview--shard"') + preview());
    const prices = [...document.querySelectorAll('[data-senkuro-price]')].map((holder) => holder.getAttribute('data-senkuro-price'));
    expect(prices).toEqual(['1.00', '1.00']);
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

  it('puts no copy button into a card before the site has mounted its app, and draws it on the next render after the mount', () => {
    document.body.innerHTML = preview();
    document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);
    const badges = createPriceBadges({ touch: false });
    badges.update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect(holderOf().querySelector('.senkuro-copy-btn')).toBeNull();
    expect(holderOf().getAttribute('data-senkuro-price')).not.toBeNull();
    document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
    badges.update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect(holderOf().querySelectorAll('.senkuro-copy-btn')).toHaveLength(1);
  });

  it('draws the copy control as a plain element when the card link itself holds it, since a link must not contain a button', () => {
    document.body.innerHTML = '<a class="card-collect" href="/cards/soran"><img></a>';
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect(document.querySelector('a.card-collect > .senkuro-copy-btn')?.tagName).toBe('DIV');
  });

  it('draws the copy control as a plain element when an outer link wraps the card holder', () => {
    document.body.innerHTML = preview();
    const holder = holderOf();
    const outer = document.createElement('a');
    outer.href = '/offers/1';
    holder.replaceWith(outer);
    outer.append(holder);
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect(document.querySelector('.card-collect-preview > .senkuro-copy-btn')?.tagName).toBe('DIV');
  });

  it('copies the visible name from the control inside a link without following the link', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    document.body.innerHTML = '<a class="card-collect" href="/cards/soran"><img></a>';
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    const control = document.querySelector('.senkuro-copy-btn') as HTMLElement;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    control.dispatchEvent(click);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('Соран');
    expect(click.defaultPrevented).toBe(true);
    expect(control.classList.contains('senkuro-copy-btn--done')).toBe(true);
  });

  it('copies the name the card shows on its front, not an older one from the price database', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    document.body.innerHTML = `<a class="card-collect" href="/cards/soran">
      <div class="card-collect__front"><img class="card-collect__img" alt=" Соран Мин "></div>
      <div class="card-collect__back"><img class="card-collect__img" alt="Рубашка карты Соран Мин"></div>
    </a>`;
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    const control = document.querySelector('.senkuro-copy-btn') as HTMLElement;
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('Соран Мин');
    expect(control.title).toBe('Копировать имя: Соран Мин');
  });

  it.each([
    ['a video', '<video class="card-collect__video"></video>'],
    ['only the rank frame', '<img class="card-collect__frame" alt="Рамка F ранга">'],
    ['an image without a name', '<img class="card-collect__img">'],
    ['nothing', ''],
  ])('copies the database name when the card front shows %s', (_case, front) => {
    document.body.innerHTML = `<a class="card-collect" href="/cards/soran">
      <div class="card-collect__front">${front}</div>
      <div class="card-collect__back"><img class="card-collect__img" alt="Рубашка карты Соран Мин"></div>
    </a>`;
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    expect((document.querySelector('.senkuro-copy-btn') as HTMLElement).title).toBe('Копировать имя: Соран');
  });

  it('restores the copy icon after the done mark, and says nothing is copied when the clipboard refuses', async () => {
    vi.useFakeTimers();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.body.innerHTML = preview();
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    const control = holderOf().querySelector('.senkuro-copy-btn') as HTMLElement;
    control.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.classList.contains('senkuro-copy-btn--done')).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(control.classList.contains('senkuro-copy-btn--done')).toBe(false);
    control.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(control.classList.contains('senkuro-copy-btn--done')).toBe(false);
    expect(warn).toHaveBeenCalledWith('SenkuTools: clipboard', expect.any(Error));
  });

  it('draws the copy button as a real button, so a keyboard reaches it', () => {
    document.body.innerHTML = preview();
    createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
    const button = holderOf().querySelector('.senkuro-copy-btn');
    expect(button?.tagName).toBe('BUTTON');
    expect((button as HTMLButtonElement).type).toBe('button');
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

  it.each([
    [168, '16px'],
    [150, '16px'],
    [144, '13px'],
    [120, '13px'],
    [117, '10px'],
    [95, '10px'],
    [93, '9px'],
    [50, '9px'],
  ])('sizes the price of a %ipx card at %s', (width, expected) => {
    renderAtWidth(width);
    expect(document.querySelector<HTMLElement>('[data-senkuro-price]')?.style.getPropertyValue('--s-size')).toBe(expected);
  });

  it('keeps the chosen size on a card whose width is not known', () => {
    renderAtWidth(0);
    expect(document.querySelector<HTMLElement>('[data-senkuro-price]')?.style.getPropertyValue('--s-size')).toBe('16px');
  });

  it('never grows the chosen size and never goes under the smallest readable one', () => {
    for (const [width, base, expected] of [
      [103, 24, '16px'],
      [168, 9, '9px'],
      [50, 12, '9px'],
    ] as const) {
      document.body.innerHTML = preview();
      for (const link of document.querySelectorAll('a.card-collect')) Object.defineProperty(link, 'offsetWidth', { value: width });
      createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, fontSize: base });
      expect(document.querySelector<HTMLElement>('[data-senkuro-price]')?.style.getPropertyValue('--s-size')).toBe(expected);
    }
  });

  describe('when the card is resized', () => {
    interface FakeWatch {
      observe: ReturnType<typeof vi.fn>;
      unobserve: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      fire: (...targets: Element[]) => void;
    }
    let watch: FakeWatch;

    beforeEach(() => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
          constructor(callback: ResizeObserverCallback) {
            watch = {
              observe: this.observe,
              unobserve: this.unobserve,
              disconnect: this.disconnect,
              fire: (...targets) =>
                callback(
                  targets.map((target) => ({ target }) as ResizeObserverEntry),
                  this
                ),
            };
          }
        }
      );
    });

    afterEach(() => vi.unstubAllGlobals());

    const widthOf = (link: Element, width: number) => Object.defineProperty(link, 'offsetWidth', { value: width, configurable: true });
    const linkOf = () => document.querySelector('.card-collect-preview__front a.card-collect') as HTMLAnchorElement;
    const sizeOf = () => document.querySelector<HTMLElement>('[data-senkuro-price]')?.style.getPropertyValue('--s-size');

    const renderWatched = (width: number, settings = DEFAULT_SETTINGS) => {
      document.body.innerHTML = preview();
      widthOf(linkOf(), width);
      const badges = createPriceBadges({ touch: false });
      badges.update(db, settings);
      return badges;
    };

    it.each([100, 24, 1])('watches a %ipx card, a card too narrow for a price included', (width) => {
      renderWatched(width);
      expect(watch.observe).toHaveBeenCalledWith(linkOf());
    });

    it('watches no card it never measured', () => {
      renderWatched(100, { ...DEFAULT_SETTINGS, showBadges: false });
      expect(watch.observe).not.toHaveBeenCalled();
      expect(watch.unobserve).toHaveBeenCalledWith(linkOf());
    });

    it('takes the price off a card that shrinks under 30px and puts it back when it grows', () => {
      renderWatched(40);
      expect(document.querySelector('[data-senkuro-price]')).not.toBeNull();
      widthOf(linkOf(), 24);
      watch.fire(linkOf());
      expect(document.querySelector('[data-senkuro-price]')).toBeNull();
      widthOf(linkOf(), 40);
      watch.fire(linkOf());
      expect(document.querySelector('[data-senkuro-price]')?.getAttribute('data-senkuro-price')).toBe('1.00');
    });

    it('takes the copy button off a card that shrinks under 60px and puts it back when it grows', () => {
      renderWatched(80, { ...DEFAULT_SETTINGS, copyBtn: true });
      expect(document.querySelector('.senkuro-copy-btn')).not.toBeNull();
      widthOf(linkOf(), 50);
      watch.fire(linkOf());
      expect(document.querySelector('.senkuro-copy-btn')).toBeNull();
      expect(document.querySelector('[data-senkuro-price]')).not.toBeNull();
      widthOf(linkOf(), 80);
      watch.fire(linkOf());
      expect(document.querySelector('.senkuro-copy-btn')).not.toBeNull();
    });

    it('refits the size when the card crosses into another band, with the price kept', () => {
      renderWatched(168);
      expect(sizeOf()).toBe('16px');
      widthOf(linkOf(), 103);
      watch.fire(linkOf());
      expect(sizeOf()).toBe('10px');
      expect(document.querySelector('[data-senkuro-price]')?.getAttribute('data-senkuro-price')).toBe('1.00');
    });

    it('leaves the badge alone while the width stays in the same band', () => {
      renderWatched(168);
      widthOf(linkOf(), 150);
      const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
      watch.fire(linkOf());
      expect(setAttribute).not.toHaveBeenCalled();
      expect(sizeOf()).toBe('16px');
    });

    it('refits the question mark of a card the database does not know', () => {
      document.body.innerHTML =
        '<a class="card-collect" href="/cards/hsr-kafka-c"><div class="card-collect__front"><img class="card-collect__img" alt="Кафка"></div></a>';
      const link = document.querySelector('a.card-collect') as HTMLAnchorElement;
      widthOf(link, 168);
      createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS);
      expect(link.style.getPropertyValue('--s-size')).toBe('16px');
      widthOf(link, 103);
      watch.fire(link);
      expect(link.style.getPropertyValue('--s-size')).toBe('10px');
    });

    it('stops watching a card that left the page and every card after a reset', () => {
      const badges = renderWatched(168);
      const link = linkOf();
      link.remove();
      watch.fire(link);
      expect(watch.unobserve).toHaveBeenCalledWith(link);
      badges.reset();
      expect(watch.disconnect).toHaveBeenCalled();
    });

    it('ignores a resize before any update and a node that is not a card link', () => {
      createPriceBadges({ touch: false });
      expect(() => watch.fire(document.body)).not.toThrow();
      renderWatched(168);
      expect(() => watch.fire(document.body)).not.toThrow();
      expect(sizeOf()).toBe('16px');
    });

    it('paints, drops an undrawn card and resets without a resize observer too', () => {
      vi.stubGlobal('ResizeObserver', undefined);
      const badges = renderWatched(103);
      expect(sizeOf()).toBe('10px');
      document.body.innerHTML = preview();
      widthOf(linkOf(), 24);
      expect(() => badges.update(db, DEFAULT_SETTINGS)).not.toThrow();
      document.body.innerHTML = preview();
      expect(() => badges.update(db, { ...DEFAULT_SETTINGS, showBadges: false })).not.toThrow();
      expect(() => badges.reset()).not.toThrow();
    });

    it('ignores a card resize that arrives before the first update', () => {
      createPriceBadges({ touch: false });
      document.body.innerHTML = preview();
      watch.fire(linkOf());
      expect(document.querySelector('[data-senkuro-price]')).toBeNull();
    });
  });

  it('measures every card of a batch before it paints any of them, so a batch costs one layout and not one per card', () => {
    document.body.innerHTML = preview().repeat(3);
    const read = vi.fn();
    const reading = (value: unknown) => ({
      get: () => {
        read();
        return value;
      },
    });
    for (const root of document.querySelectorAll<HTMLElement>('.card-collect-preview')) {
      const face = root.querySelector('.card-collect-preview__flip-container') as HTMLElement;
      const link = root.querySelector('.card-collect-preview__front a.card-collect') as HTMLElement;
      Object.defineProperties(link, { offsetWidth: reading(100) });
      Object.defineProperties(face, { offsetParent: reading(root), offsetTop: reading(0), offsetHeight: reading(150) });
      Object.defineProperties(root, { offsetHeight: reading(150) });
    }
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS);
    const paints = [...setAttribute.mock.calls.entries()].flatMap(([index, [name]]) =>
      name === 'data-senkuro-price' ? [setAttribute.mock.invocationCallOrder[index] ?? 0] : []
    );
    expect(paints).toHaveLength(3);
    expect(read).toHaveBeenCalled();
    expect(Math.min(...paints)).toBeGreaterThan(Math.max(...read.mock.invocationCallOrder));
  });

  describe('on a card the price database does not know', () => {
    const unknownCard = (front = '<img class="card-collect__img" alt="Кафка">') =>
      `<a class="card-collect" href="/cards/hsr-kafka-c"><div class="card-collect__front">${front}</div></a>`;
    const markOf = () => document.querySelector('a.card-collect > .senkutools-unpriced-badge');

    it('puts the site question mark where the price would be and no price', () => {
      document.body.innerHTML = unknownCard();
      createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS);
      expect(markOf()?.querySelector('path')?.getAttribute('d')).toMatch(/^M584-637q0-43/);
      expect(markOf()?.classList.contains('senkutools-unpriced-badge--outline')).toBe(false);
      const card = document.querySelector('a.card-collect') as HTMLElement;
      expect(card.hasAttribute('data-senkuro-price')).toBe(false);
      expect(card.style.getPropertyValue('--s-size')).toBe('16px');
    });

    it('draws the question mark in the outline style when the badges use it', () => {
      document.body.innerHTML = unknownCard();
      createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, badgeStyle: 'outline' });
      expect(markOf()?.classList.contains('senkutools-unpriced-badge--outline')).toBe(true);
    });

    it('gives the card a copy button with the name its front shows', () => {
      document.body.innerHTML = unknownCard();
      createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
      expect((document.querySelector('.senkuro-copy-btn') as HTMLElement).title).toBe('Копировать имя: Кафка');
    });

    it('gives the card no copy button when its front shows no name, and keeps the question mark', () => {
      document.body.innerHTML = unknownCard('<video class="card-collect__video"></video>');
      createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, copyBtn: true });
      expect(document.querySelector('.senkuro-copy-btn')).toBeNull();
      expect(markOf()).not.toBeNull();
    });

    it('draws no question mark with the prices switched off, and leaves the card alone without a name to copy', () => {
      document.body.innerHTML = unknownCard('');
      createPriceBadges({ touch: false }).update(db, { ...DEFAULT_SETTINGS, showBadges: false, copyBtn: true });
      expect(markOf()).toBeNull();
      expect(document.querySelector('.senkuro-copy-btn')).toBeNull();
      expect((document.querySelector('a.card-collect') as HTMLElement).getAttribute('style')).toBeNull();
    });

    it('swaps the question mark for the price once the database knows the card, and back', () => {
      document.body.innerHTML = unknownCard();
      const badges = createPriceBadges({ touch: false });
      badges.update(db, DEFAULT_SETTINGS);
      expect(markOf()).not.toBeNull();
      const pricedDb = { ...db, 'hsr-kafka-c': { price: 2.5, name: 'Кафка', rank: 'C' } };
      badges.reset();
      badges.update(pricedDb, DEFAULT_SETTINGS);
      expect(markOf()).toBeNull();
      expect(document.querySelector('a.card-collect')?.getAttribute('data-senkuro-price')).toBe('2.00');
      badges.reset();
      badges.update(db, DEFAULT_SETTINGS);
      expect(markOf()).not.toBeNull();
      expect(document.querySelector('a.card-collect')?.hasAttribute('data-senkuro-price')).toBe(false);
    });

    it('inserts nothing before the site has mounted its app and draws the mark on the next render after the mount', () => {
      document.documentElement.removeAttribute(APP_MOUNTED_ATTRIBUTE);
      document.body.innerHTML = unknownCard();
      const badges = createPriceBadges({ touch: false });
      badges.update(db, DEFAULT_SETTINGS);
      expect(markOf()).toBeNull();
      expect((document.querySelector('a.card-collect') as HTMLElement).dataset.priceBadgeAdded).toBeUndefined();
      document.documentElement.setAttribute(APP_MOUNTED_ATTRIBUTE, '');
      badges.update(db, DEFAULT_SETTINGS);
      expect(markOf()).not.toBeNull();
    });

    it('marks nothing while the price database is empty, as after a failed load', () => {
      document.body.innerHTML = unknownCard();
      createPriceBadges({ touch: false }).update({}, { ...DEFAULT_SETTINGS, copyBtn: true });
      expect(markOf()).toBeNull();
      expect(document.querySelector('.senkuro-copy-btn')).toBeNull();
    });

    it('puts one question mark on the preview holder and none on the flip side', () => {
      document.body.innerHTML = preview().replaceAll('/cards/soran', '/cards/hsr-kafka-c');
      createPriceBadges({ touch: false }).update(db, DEFAULT_SETTINGS);
      expect(document.querySelectorAll('.senkutools-unpriced-badge')).toHaveLength(1);
      expect(holderOf().querySelector(':scope > .senkutools-unpriced-badge')).not.toBeNull();
    });

    it('reads the size of one database once however often the cards are drawn', () => {
      const keys = vi.spyOn(Object, 'keys');
      const badges = createPriceBadges({ touch: false });
      for (let round = 0; round < 3; round++) {
        document.body.innerHTML = unknownCard();
        badges.update(db, DEFAULT_SETTINGS);
      }
      expect(keys.mock.calls.filter(([target]) => target === db)).toHaveLength(1);
      expect(document.querySelectorAll('.senkutools-unpriced-badge')).toHaveLength(1);
    });

    it('removes the question marks with the rest of the page marks', () => {
      document.body.innerHTML = unknownCard();
      const badges = createPriceBadges({ touch: false });
      badges.update(db, DEFAULT_SETTINGS);
      badges.resetPage();
      expect(markOf()).toBeNull();
    });
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

    it('reads no layout when it has nothing to draw, and does when the copy button is on', () => {
      document.body.innerHTML = preview().repeat(2);
      const read = vi.fn();
      for (const link of document.querySelectorAll<HTMLElement>('a.card-collect')) {
        Object.defineProperty(link, 'offsetWidth', {
          get: () => {
            read();
            return 100;
          },
        });
      }
      const computed = vi.spyOn(window, 'getComputedStyle');
      createPriceBadges({ touch: false }).update(db, pricesOff);
      expect(read).not.toHaveBeenCalled();
      expect(computed).not.toHaveBeenCalled();
      document.body.querySelectorAll('[data-price-badge-added]').forEach((link) => link.removeAttribute('data-price-badge-added'));
      createPriceBadges({ touch: false }).update(db, { ...pricesOff, copyBtn: true });
      expect(read).toHaveBeenCalled();
    });

    it('takes the copy button away when it is switched off while the prices are off', () => {
      document.body.innerHTML = preview();
      const badges = createPriceBadges({ touch: false });
      badges.update(db, { ...pricesOff, copyBtn: true });
      expect(document.querySelector('.senkuro-copy-btn')).not.toBeNull();
      badges.reset();
      badges.update(db, pricesOff);
      expect(document.querySelector('.senkuro-copy-btn')).toBeNull();
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
