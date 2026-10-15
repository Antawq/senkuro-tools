import { BADGE_INSET, CENTER, CENTER_SHIFT_X, centerShiftY, faceGap, gapKey, insetAbove, insetBelow, NO_GAP, type FaceGap } from './badge-layout';
import { CARD_LINK, PERCENT, PRICE_DECIMALS, effectivePrice, slugFromHref } from './cards';
import { removeCopyButton, syncCopyButton } from './copy-button';
import type { Database } from './database';
import type { BadgePositionX, BadgePositionY, Settings } from './settings';
import { tierOf } from './tiers';

const BADGE_ATTRIBUTES = ['data-senkuro-price', 'data-senkuro-style', 'data-senkuro-eff', 'data-senkuro-tier'];
const SMALL_CARD_WIDTH = 60;
const MIN_PRICED_CARD_WIDTH = 40;
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

const POSITION_PROPS = ['--s-top', '--s-bottom', '--s-left', '--s-right', '--s-mt', '--s-ml', '--s-align'];

export interface PriceBadges {
  update(db: Database, settings: Settings, cards?: Iterable<HTMLAnchorElement>): void;
  reset(): void;
  resetPage(): void;
}

const shadesOf = (opacity: number) => {
  const shade = `rgb(0 0 0 / ${opacity / PERCENT})`;
  return { background: shade, outline: OUTLINE_OFFSETS.map((offset) => `${offset} ${shade}`).join(',') };
};

function imageSource(img: HTMLImageElement): string {
  let source = img.src && img.src !== document.baseURI ? img.src : '';
  if (!source || source.startsWith('data:')) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    source = srcset.trim().split(/[,\s]/)[0]?.trim() ?? '';
  }
  return source.startsWith('data:') ? '' : source;
}

function applyPosition(target: HTMLElement, positionX: BadgePositionX, positionY: BadgePositionY, gap: FaceGap): void {
  POSITION_PROPS.forEach((prop) => target.style.removeProperty(prop));

  if (positionY === 'top') target.style.setProperty('--s-top', insetAbove(gap));
  else if (positionY === 'bottom') target.style.setProperty('--s-bottom', insetBelow(gap));
  else if (positionY === 'center') {
    target.style.setProperty('--s-top', CENTER);
    target.style.setProperty('--s-mt', centerShiftY(gap));
  }

  if (positionX === 'left') {
    target.style.setProperty('--s-left', BADGE_INSET);
    target.style.setProperty('--s-align', 'left');
  } else if (positionX === 'right') {
    target.style.setProperty('--s-right', BADGE_INSET);
    target.style.setProperty('--s-align', 'right');
  } else if (positionX === 'center') {
    target.style.setProperty('--s-left', CENTER);
    target.style.setProperty('--s-ml', CENTER_SHIFT_X);
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

export function createPriceBadges({ onImageLoad, touch }: { onImageLoad: () => void; touch: boolean }): PriceBadges {
  const waitingImages = new WeakSet<HTMLImageElement>();
  const positioned = new WeakSet<HTMLElement>();

  function render(card: HTMLAnchorElement, db: Database, settings: Settings, shades: ReturnType<typeof shadesOf>): void {
    if (!card.isConnected || card.closest(BACK_FACE)) return;
    const slug = slugFromHref(card.getAttribute('href'));
    if (!slug || card.dataset.priceBadgeAdded === slug) return;
    const entry = db[slug];
    if (!entry || typeof entry.price !== 'number' || !Number.isFinite(entry.price)) return;

    const img = card.querySelector('img');
    if (img && !imageSource(img) && onImageLoad && !waitingImages.has(img)) {
      waitingImages.add(img);
      img.addEventListener('load', onImageLoad, { once: true });
    }

    const priceText = effectivePrice(entry.price, settings.commission).toFixed(PRICE_DECIMALS);
    const tier = tierOf(+priceText);
    const effect = settings[tier.effect];

    const front = card.closest<HTMLElement>('.card-collect-preview__front');
    const preview = card.closest<HTMLElement>('.card-collect-preview');
    const target = preview ?? card;

    const width = card.offsetWidth || card.getBoundingClientRect().width;
    if (width > 0 && width < MIN_PRICED_CARD_WIDTH) {
      for (const el of [card, front, preview]) {
        if (el) {
          clearBadge(el);
          removeCopyButton(el);
        }
      }
      card.dataset.priceBadgeAdded = slug;
      return;
    }

    if (!positioned.has(target)) {
      if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
      positioned.add(target);
    }

    const small = width > 0 && width < SMALL_CARD_WIDTH;
    const fontSize = small
      ? Math.max(SMALL_CARD_MIN_FONT, Math.round(settings.fontSize * Math.max(SMALL_CARD_MIN_SCALE, width / SMALL_CARD_SCALE_BASE)))
      : settings.fontSize;

    for (const el of [card, front, preview]) {
      if (el && el !== target) {
        clearBadge(el);
        removeCopyButton(el);
      }
    }

    target.setAttribute('data-senkuro-price', priceText);
    target.setAttribute('data-senkuro-style', settings.badgeStyle);
    target.setAttribute('data-senkuro-eff', effect || NO_EFFECT);
    target.setAttribute('data-senkuro-tier', tier.name);
    target.style.setProperty('--s-size', `${fontSize}px`);
    target.style.setProperty('--s-pad', small ? SMALL_PADDING : PADDING);
    if (settings.badgeStyle === 'background') {
      target.style.setProperty('--s-bg-color', shades.background);
      target.style.removeProperty('--s-outline');
    } else {
      target.style.setProperty('--s-outline', shades.outline);
      target.style.removeProperty('--s-bg-color');
    }

    const positionX = coveredInStack(target) ? VISIBLE_EDGE : settings.positionX;
    const positionY = settings.positionY;
    const gap = preview ? faceGap(preview) : NO_GAP;
    const posKey = `${positionX}-${positionY}${gapKey(gap)}`;
    if (target.dataset.badgePos !== posKey) {
      target.dataset.badgePos = posKey;
      applyPosition(target, positionX, positionY, gap);
    }

    if (settings.copyBtn && !small) syncCopyButton(target, { name: entry.name || UNKNOWN_NAME, size: settings.copyBtnSize, positionX, positionY, gap, touch });
    else removeCopyButton(target);

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
