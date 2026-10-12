import { effectivePrice, slugFromHref } from './cards';
import { removeCopyButton, syncCopyButton } from './copy-button';
import type { Database } from './database';
import type { BadgePositionX, BadgePositionY, PriceEffect, Settings } from './settings';

const BADGE_ATTRIBUTES = ['data-senkuro-price', 'data-senkuro-style', 'data-senkuro-eff'];
const SMALL_CARD_WIDTH = 60;
const SMALL_CARD_SCALE_BASE = 70;
const SMALL_CARD_MIN_SCALE = 0.6;
const SMALL_CARD_MIN_FONT = 9;
const PADDING = '2px 6px';
const SMALL_PADDING = '1px 3px';
const BACK_FACE = '.card-collect-preview__back';
const TRADE_FAN = '.modal-trade__swap-cards';
const TRADE_FAN_POSITION: { x: BadgePositionX; y: BadgePositionY } = { x: 'left', y: 'center' };

const POSITION_PROPS = ['--s-top', '--s-bottom', '--s-left', '--s-right', '--s-mt', '--s-ml', '--s-align'];

type EffectKey = 'effectRed' | 'effectYellow' | 'effectPurple' | 'effectGreen' | 'effectWhite';

const TIERS: { from: number; color: string; effect: EffectKey }[] = [
  { from: 3.0, color: '#f87171', effect: 'effectRed' },
  { from: 2.4, color: '#fbbf24', effect: 'effectYellow' },
  { from: 2.0, color: '#c084fc', effect: 'effectPurple' },
  { from: 1.6, color: '#4ade80', effect: 'effectGreen' },
  { from: -Infinity, color: '#ffffff', effect: 'effectWhite' },
];

export interface PriceBadges {
  update(db: Database, settings: Settings, cards?: Iterable<HTMLAnchorElement>): void;
  reset(): void;
  resetPage(): void;
}

const shadesOf = (opacity: number) => {
  const shade = `rgba(0,0,0,${opacity / 100})`;
  return { background: shade, outline: `1px 1px 0 ${shade},-1px -1px 0 ${shade},1px -1px 0 ${shade},-1px 1px 0 ${shade},0px 2px 4px ${shade}` };
};

function imageSource(img: HTMLImageElement): string {
  let source = img.src && img.src !== document.baseURI ? img.src : '';
  if (!source || source.startsWith('data:')) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    source = srcset.trim().split(/[,\s]/)[0]?.trim() ?? '';
  }
  return source.startsWith('data:') ? '' : source;
}

function applyPosition(target: HTMLElement, positionX: BadgePositionX, positionY: BadgePositionY): void {
  POSITION_PROPS.forEach((prop) => target.style.removeProperty(prop));

  if (positionY === 'top') target.style.setProperty('--s-top', '5px');
  else if (positionY === 'bottom') target.style.setProperty('--s-bottom', '5px');
  else if (positionY === 'center') {
    target.style.setProperty('--s-top', '50%');
    target.style.setProperty('--s-mt', '-12px');
  }

  if (positionX === 'left') {
    target.style.setProperty('--s-left', '5px');
    target.style.setProperty('--s-align', 'left');
  } else if (positionX === 'right') {
    target.style.setProperty('--s-right', '5px');
    target.style.setProperty('--s-align', 'right');
  } else if (positionX === 'center') {
    target.style.setProperty('--s-left', '50%');
    target.style.setProperty('--s-ml', '-15px');
    target.style.setProperty('--s-align', 'center');
  }
}

const clearBadge = (el: Element) => BADGE_ATTRIBUTES.forEach((attribute) => el.removeAttribute(attribute));

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

    const priceText = effectivePrice(entry.price, settings.commission).toFixed(2);
    const tier = TIERS.find(({ from }) => +priceText >= from) ?? TIERS[TIERS.length - 1];
    const effect: PriceEffect = tier ? settings[tier.effect] : '';

    const front = card.closest<HTMLElement>('.card-collect-preview__front');
    const preview = card.closest<HTMLElement>('.card-collect-preview');
    const target = preview ?? card;

    if (!positioned.has(target)) {
      if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
      positioned.add(target);
    }

    const width = card.offsetWidth || card.getBoundingClientRect().width;
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
    target.setAttribute('data-senkuro-eff', effect || 'none');
    target.style.setProperty('--s-color', tier?.color ?? '#ffffff');
    target.style.setProperty('--s-size', `${fontSize}px`);
    target.style.setProperty('--s-pad', small ? SMALL_PADDING : PADDING);
    if (settings.badgeStyle === 'background') {
      target.style.setProperty('--s-bg-color', shades.background);
      target.style.removeProperty('--s-outline');
    } else {
      target.style.setProperty('--s-outline', shades.outline);
      target.style.removeProperty('--s-bg-color');
    }

    const { x: positionX, y: positionY } = target.closest(TRADE_FAN) ? TRADE_FAN_POSITION : { x: settings.positionX, y: settings.positionY };
    const posKey = `${positionX}-${positionY}`;
    if (target.dataset.badgePos !== posKey) {
      target.dataset.badgePos = posKey;
      applyPosition(target, positionX, positionY);
    }

    if (settings.copyBtn && !small) syncCopyButton(target, { name: entry.name || 'Неизвестно', size: settings.copyBtnSize, positionX, positionY, touch });
    else removeCopyButton(target);

    card.dataset.priceBadgeAdded = slug;
  }

  const reset = () => {
    document.querySelectorAll('[data-senkuro-price]').forEach(clearBadge);
    document.querySelectorAll<HTMLElement>('a.card-collect').forEach((card) => delete card.dataset.priceBadgeAdded);
  };

  return {
    update(db, settings, cards?: Iterable<HTMLAnchorElement>) {
      const shades = shadesOf(settings.opacity);
      const list = cards ?? document.querySelectorAll<HTMLAnchorElement>('a.card-collect');
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
