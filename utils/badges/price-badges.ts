import { BADGE_INSET, CENTER, CENTERING_SHIFT, centerGapShift, faceGap, gapKey, insetAbove, insetBelow, NO_GAP, type FaceGap } from '../shared/badge-layout';
import { CARD_LINK, PERCENT, PRICE_DECIMALS, effectivePrice, slugFromHref } from '../shared/cards';
import { removeCopyButton, syncCopyButton } from '../shared/copy-button';
import type { CardEntry, Database } from '../shared/database';
import type { BadgePositionX, BadgePositionY, Settings } from '../shared/settings';
import { tierOf } from './tiers';

const BADGE_ATTRIBUTES = ['data-senkuro-price', 'data-senkuro-style', 'data-senkuro-eff', 'data-senkuro-tier'];
const SMALL_CARD_WIDTH = 60;
const MIN_PRICED_CARD_WIDTH = 30;
const SMALL_CARD_SCALE_BASE = 70;
const SMALL_CARD_MIN_SCALE = 0.6;
const SMALL_CARD_MIN_FONT = 9;
const PADDING = '2px 6px';
const SMALL_PADDING = '1px 3px';
const OUTLINE_OFFSETS = ['1px 1px 0', '-1px -1px 0', '1px -1px 0', '-1px 1px 0', '0px 2px 4px'];
const UNKNOWN_NAME = 'Неизвестно';
const NO_EFFECT = 'none';
const BACK_FACE = '.card-collect-preview__back';
const STACK_ITEM = '.offer-card__cnt-el, .modal-trade__swap-cards > .modal-trade__card';
const VISIBLE_EDGE: BadgePositionX = 'left';

const POSITION_PROPS = ['--s-top', '--s-bottom', '--s-left', '--s-right', '--s-mt', '--s-tx', '--s-ty', '--s-align'];

export interface PriceBadges {
  update(db: Database, settings: Settings, cards?: Iterable<HTMLAnchorElement>): void;
  reset(): void;
  resetPage(): void;
}

const shadesOf = (opacity: number) => {
  const shade = `rgb(0 0 0 / ${opacity / PERCENT})`;
  return { background: shade, outline: OUTLINE_OFFSETS.map((offset) => `${offset} ${shade}`).join(',') };
};

function applyPosition(target: HTMLElement, positionX: BadgePositionX, positionY: BadgePositionY, gap: FaceGap): void {
  POSITION_PROPS.forEach((prop) => target.style.removeProperty(prop));

  if (positionY === 'top') target.style.setProperty('--s-top', insetAbove(gap));
  else if (positionY === 'bottom') target.style.setProperty('--s-bottom', insetBelow(gap));
  else if (positionY === 'center') {
    target.style.setProperty('--s-top', CENTER);
    target.style.setProperty('--s-ty', CENTERING_SHIFT);
    target.style.setProperty('--s-mt', centerGapShift(gap));
  }

  if (positionX === 'left') {
    target.style.setProperty('--s-left', BADGE_INSET);
    target.style.setProperty('--s-align', 'left');
  } else if (positionX === 'right') {
    target.style.setProperty('--s-right', BADGE_INSET);
    target.style.setProperty('--s-align', 'right');
  } else if (positionX === 'center') {
    target.style.setProperty('--s-left', CENTER);
    target.style.setProperty('--s-tx', CENTERING_SHIFT);
    target.style.setProperty('--s-align', 'center');
  }
}

const clearBadge = (el: Element) => BADGE_ATTRIBUTES.forEach((attribute) => el.removeAttribute(attribute));

const layerOf = (el: Element): number => Number.parseInt(getComputedStyle(el).zIndex, 10) || 0;

const paintsAbove = (other: Element, item: Element): boolean => {
  const layer = layerOf(other) - layerOf(item);
  return layer > 0 || (layer === 0 && Boolean(item.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING));
};

function coveredInStack(target: HTMLElement): boolean {
  if (!target.matches(STACK_ITEM)) return false;
  return [...(target.parentElement?.children ?? [])].some((other) => other !== target && other.matches(STACK_ITEM) && paintsAbove(other, target));
}

type Shades = ReturnType<typeof shadesOf>;

interface Holders {
  card: HTMLAnchorElement;
  front: HTMLElement | null;
  preview: HTMLElement | null;
  target: HTMLElement;
  width: number;
}

interface Spot {
  positionX: BadgePositionX;
  positionY: BadgePositionY;
  gap: FaceGap;
}

function holdersOf(card: HTMLAnchorElement): Holders {
  const front = card.closest<HTMLElement>('.card-collect-preview__front');
  const preview = card.closest<HTMLElement>('.card-collect-preview');
  return { card, front, preview, target: preview ?? card, width: card.offsetWidth || card.getBoundingClientRect().width };
}

const isSmall = ({ width }: Holders): boolean => width > 0 && width < SMALL_CARD_WIDTH;

const isTooNarrow = ({ width }: Holders): boolean => width > 0 && width < MIN_PRICED_CARD_WIDTH;

function clearHolders({ card, front, preview }: Holders, keep?: HTMLElement): void {
  for (const el of [card, front, preview]) {
    if (el && el !== keep) {
      clearBadge(el);
      removeCopyButton(el);
    }
  }
}

const fontSizeOf = (holders: Holders, base: number): number =>
  isSmall(holders) ? Math.max(SMALL_CARD_MIN_FONT, Math.round(base * Math.max(SMALL_CARD_MIN_SCALE, holders.width / SMALL_CARD_SCALE_BASE))) : base;

function paint(holders: Holders, price: number, settings: Settings, shades: Shades): void {
  const { target } = holders;
  const priceText = effectivePrice(price, settings.commission).toFixed(PRICE_DECIMALS);
  const tier = tierOf(+priceText);
  target.setAttribute('data-senkuro-price', priceText);
  target.setAttribute('data-senkuro-style', settings.badgeStyle);
  target.setAttribute('data-senkuro-eff', settings[tier.effect] || NO_EFFECT);
  target.setAttribute('data-senkuro-tier', tier.name);
  target.style.setProperty('--s-size', `${fontSizeOf(holders, settings.fontSize)}px`);
  target.style.setProperty('--s-pad', isSmall(holders) ? SMALL_PADDING : PADDING);
  if (settings.badgeStyle === 'background') {
    target.style.setProperty('--s-bg-color', shades.background);
    target.style.removeProperty('--s-outline');
  } else {
    target.style.setProperty('--s-outline', shades.outline);
    target.style.removeProperty('--s-bg-color');
  }
}

function place({ target, preview }: Holders, settings: Settings): Spot {
  const spot: Spot = {
    positionX: coveredInStack(target) ? VISIBLE_EDGE : settings.positionX,
    positionY: settings.positionY,
    gap: preview ? faceGap(preview) : NO_GAP,
  };
  const key = `${spot.positionX}-${spot.positionY}${gapKey(spot.gap)}`;
  if (target.dataset.badgePos !== key) {
    target.dataset.badgePos = key;
    applyPosition(target, spot.positionX, spot.positionY, spot.gap);
  }
  return spot;
}

export function createPriceBadges({ touch }: { touch: boolean }): PriceBadges {
  const positioned = new WeakSet<HTMLElement>();

  function makePositioned(target: HTMLElement): void {
    if (positioned.has(target)) return;
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    positioned.add(target);
  }

  function show(holders: Holders, entry: CardEntry, settings: Settings, shades: Shades): void {
    const { target } = holders;
    makePositioned(target);
    clearHolders(holders, target);
    paint(holders, entry.price, settings, shades);
    const spot = place(holders, settings);
    if (settings.copyBtn && !isSmall(holders)) syncCopyButton(target, { name: entry.name || UNKNOWN_NAME, size: settings.copyBtnSize, ...spot, touch });
    else removeCopyButton(target);
  }

  function render(card: HTMLAnchorElement, db: Database, settings: Settings, shades: Shades): void {
    if (!card.isConnected || card.closest(BACK_FACE)) return;
    const slug = slugFromHref(card.getAttribute('href'));
    if (!slug || card.dataset.priceBadgeAdded === slug) return;
    const entry = db[slug];
    if (!entry || !Number.isFinite(entry.price)) return;
    const holders = holdersOf(card);
    if (isTooNarrow(holders)) clearHolders(holders);
    else show(holders, entry, settings, shades);
    card.dataset.priceBadgeAdded = slug;
  }

  const reset = () => {
    document.querySelectorAll('[data-senkuro-price]').forEach(clearBadge);
    document.querySelectorAll<HTMLElement>(CARD_LINK).forEach((card) => delete card.dataset.priceBadgeAdded);
  };

  return {
    update(db, settings, cards?: Iterable<HTMLAnchorElement>) {
      const shades = shadesOf(settings.opacity);
      const list = cards ?? document.querySelectorAll<HTMLAnchorElement>(CARD_LINK);
      for (const card of list) render(card, db, settings, shades);
    },
    reset,
    resetPage() {
      reset();
      document.querySelectorAll<HTMLElement>('[data-badge-pos]').forEach((el) => delete el.dataset.badgePos);
      document.querySelectorAll('.senkuro-copy-btn').forEach((el) => el.remove());
    },
  };
}
