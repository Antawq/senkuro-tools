import { isAppMounted } from '../shared/app-mounted';
import { BADGE_INSET, CENTER, CENTERING_SHIFT, centerGapShift, faceGap, gapKey, insetAbove, insetBelow, NO_GAP, type FaceGap } from '../shared/badge-layout';
import { CARD_LINK, PERCENT, PRICE_DECIMALS, effectivePrice, findShownName, slugFromHref } from '../shared/cards';
import { removeCopyButton, syncCopyButton } from '../shared/copy-button';
import type { CardEntry, Database } from '../shared/database';
import type { BadgePositionX, BadgePositionY, Settings } from '../shared/settings';
import { questionMarkIcon } from '../shared/svg';
import { tierOf } from './tiers';

const BADGE_ATTRIBUTES = ['data-senkuro-price', 'data-senkuro-style', 'data-senkuro-eff', 'data-senkuro-tier'];
const SMALL_CARD_WIDTH = 60;
const MIN_PRICED_CARD_WIDTH = 30;
const MIN_FONT = 9;
const SIZE_STEPS = [
  { minWidth: 150, scale: 1 },
  { minWidth: 120, scale: 0.8 },
  { minWidth: 95, scale: 0.65 },
  { minWidth: 0, scale: 0.55 },
] as const;
const BAND_EDGES = [...SIZE_STEPS.flatMap(({ minWidth }) => (minWidth > 0 ? [minWidth] : [])), SMALL_CARD_WIDTH, MIN_PRICED_CARD_WIDTH];
const OUTLINE_OFFSETS = ['1px 1px 0', '-1px -1px 0', '1px -1px 0', '-1px 1px 0', '0px 2px 4px'];
const UNKNOWN_NAME = 'Неизвестно';
const NO_EFFECT = 'none';
const BACK_FACE = '.card-collect-preview__back';
const UNPRICED_BADGE = 'senkutools-unpriced-badge';
const UNPRICED_OUTLINE = `${UNPRICED_BADGE}--outline`;
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

interface Measured {
  holders: Holders;
  slug: string;
  entry: CardEntry | null;
  name: string | null;
  isUndrawn: boolean;
  isUnpositioned: boolean;
  isCovered: boolean;
  gap: FaceGap;
}

function holdersOf(card: HTMLAnchorElement, shouldMeasure: boolean): Holders {
  const front = card.closest<HTMLElement>('.card-collect-preview__front');
  const preview = card.closest<HTMLElement>('.card-collect-preview');
  const width = shouldMeasure ? card.offsetWidth || card.getBoundingClientRect().width : 0;
  return { card, front, preview, target: preview ?? card, width };
}

const isSmall = ({ width }: Holders): boolean => width > 0 && width < SMALL_CARD_WIDTH;

const isTooNarrow = ({ width }: Holders): boolean => width > 0 && width < MIN_PRICED_CARD_WIDTH;

const removeUnpricedBadge = (holder: Element): void => holder.querySelector(`:scope > .${UNPRICED_BADGE}`)?.remove();

function clearHolders({ card, front, preview }: Holders, keep?: HTMLElement): void {
  for (const el of [card, front, preview]) {
    if (el && el !== keep) {
      clearBadge(el);
      removeCopyButton(el);
      removeUnpricedBadge(el);
    }
  }
}

const stepOf = (width: number): (typeof SIZE_STEPS)[number] => SIZE_STEPS.reduceRight((chosen, step) => (width >= step.minWidth ? step : chosen));

const bandOf = (width: number): string => String(BAND_EDGES.filter((edge) => width >= edge).length);

const fontSizeOf = ({ width }: Holders, base: number): number => Math.min(base, Math.max(MIN_FONT, Math.round(base * stepOf(width || Infinity).scale)));

function paint(holders: Holders, price: number, settings: Settings, shades: Shades): void {
  const { target } = holders;
  const priceText = effectivePrice(price, settings.commission).toFixed(PRICE_DECIMALS);
  const tier = tierOf(+priceText);
  target.setAttribute('data-senkuro-price', priceText);
  target.setAttribute('data-senkuro-style', settings.badgeStyle);
  target.setAttribute('data-senkuro-eff', settings[tier.effect] || NO_EFFECT);
  target.setAttribute('data-senkuro-tier', tier.name);
  target.style.setProperty('--s-size', `${fontSizeOf(holders, settings.fontSize)}px`);
  if (settings.badgeStyle === 'background') {
    target.style.setProperty('--s-bg-color', shades.background);
    target.style.removeProperty('--s-outline');
  } else {
    target.style.setProperty('--s-outline', shades.outline);
    target.style.removeProperty('--s-bg-color');
  }
}

function place({ target }: Holders, settings: Settings, { isCovered, gap }: Pick<Measured, 'isCovered' | 'gap'>): Spot {
  const spot: Spot = {
    positionX: isCovered ? VISIBLE_EDGE : settings.positionX,
    positionY: settings.positionY,
    gap,
  };
  const key = `${spot.positionX}-${spot.positionY}${gapKey(spot.gap)}`;
  if (target.dataset.badgePos !== key) {
    target.dataset.badgePos = key;
    applyPosition(target, spot.positionX, spot.positionY, spot.gap);
  }
  return spot;
}

interface BadgeState {
  touch: boolean;
  positioned: WeakSet<HTMLElement>;
  isFilledByDatabase: WeakMap<Database, boolean>;
  last: { db: Database; settings: Settings } | null;
  resizeWatch: ResizeObserver | null;
}

function isFilled(state: BadgeState, db: Database): boolean {
  let isFilledDatabase = state.isFilledByDatabase.get(db);
  if (isFilledDatabase === undefined) {
    isFilledDatabase = Object.keys(db).length > 0;
    state.isFilledByDatabase.set(db, isFilledDatabase);
  }
  return isFilledDatabase;
}

function cardEntryOf(card: HTMLAnchorElement, db: Database, hasDatabase: boolean): { slug: string; entry: CardEntry | null } | null {
  if (!card.isConnected || card.closest(BACK_FACE)) return null;
  const slug = slugFromHref(card.getAttribute('href'));
  if (!slug || card.dataset.priceBadgeAdded === slug) return null;
  const entry = db[slug];
  if (entry && Number.isFinite(entry.price)) return { slug, entry };
  return hasDatabase ? { slug, entry: null } : null;
}

const copiedNameOf = (card: HTMLAnchorElement, entry: CardEntry | null): string | null => findShownName(card) || (entry ? entry.name || UNKNOWN_NAME : null);

const isUndrawnFor = (holders: Holders, settings: Settings, name: string | null): boolean =>
  isTooNarrow(holders) || (!settings.showBadges && (!settings.copyBtn || isSmall(holders) || !name));

function measure(state: BadgeState, card: HTMLAnchorElement, db: Database, settings: Settings, hasDatabase: boolean): Measured | null {
  const known = cardEntryOf(card, db, hasDatabase);
  if (!known) return null;
  const holders = holdersOf(card, settings.showBadges || settings.copyBtn);
  const { target } = holders;
  const name = copiedNameOf(card, known.entry);
  const isUndrawn = isUndrawnFor(holders, settings, name);
  const isUnpositioned = !isUndrawn && !state.positioned.has(target) && getComputedStyle(target).position === 'static';
  return { holders, ...known, name, isUndrawn, isUnpositioned, isCovered: !isUndrawn && coveredInStack(target), gap: NO_GAP };
}

function position(state: BadgeState, { holders: { target }, isUnpositioned }: Measured): void {
  if (isUnpositioned) target.style.position = 'relative';
  state.positioned.add(target);
}

function syncCardCopyButton(state: BadgeState, { holders, name }: Measured, settings: Settings, spot: Spot): boolean {
  if (!settings.copyBtn || isSmall(holders) || !name) {
    removeCopyButton(holders.target);
    return true;
  }
  if (!isAppMounted(document)) return false;
  syncCopyButton(holders.target, { name, size: settings.copyBtnSize, ...spot, touch: state.touch });
  return true;
}

function syncUnpricedBadge(holders: Holders, settings: Settings, shades: Shades): boolean {
  const { target } = holders;
  clearBadge(target);
  if (!isAppMounted(document)) return false;
  target.style.setProperty('--s-size', `${fontSizeOf(holders, settings.fontSize)}px`);
  target.style.setProperty('--s-bg-color', shades.background);
  let badge = target.querySelector<HTMLElement>(`:scope > .${UNPRICED_BADGE}`);
  if (!badge) {
    badge = document.createElement('span');
    badge.className = UNPRICED_BADGE;
    badge.append(questionMarkIcon(settings.fontSize));
    target.append(badge);
  }
  badge.classList.toggle(UNPRICED_OUTLINE, settings.badgeStyle === 'outline');
  return true;
}

function markCard({ holders, entry }: Measured, settings: Settings, shades: Shades): boolean {
  if (!settings.showBadges || entry) removeUnpricedBadge(holders.target);
  if (!settings.showBadges) return true;
  if (!entry) return syncUnpricedBadge(holders, settings, shades);
  paint(holders, entry.price, settings, shades);
  return true;
}

function watchSize(state: BadgeState, { card, width }: Holders): void {
  if (width > 0) {
    card.dataset.badgeBand = bandOf(width);
    state.resizeWatch?.observe(card);
  } else {
    delete card.dataset.badgeBand;
    state.resizeWatch?.unobserve(card);
  }
}

function show(state: BadgeState, measured: Measured, settings: Settings, shades: Shades): void {
  const { holders, slug, isUndrawn } = measured;
  let isDone = true;
  watchSize(state, holders);
  if (isUndrawn) clearHolders(holders);
  else {
    clearHolders(holders, holders.target);
    const isMarked = markCard(measured, settings, shades);
    isDone = syncCardCopyButton(state, measured, settings, place(holders, settings, measured)) && isMarked;
  }
  if (isDone) holders.card.dataset.priceBadgeAdded = slug;
}

function resetBadges(state: BadgeState): void {
  state.resizeWatch?.disconnect();
  document.querySelectorAll('[data-senkuro-price]').forEach(clearBadge);
  document.querySelectorAll<HTMLElement>(CARD_LINK).forEach((card) => {
    delete card.dataset.priceBadgeAdded;
    delete card.dataset.badgeBand;
  });
}

function resetPageBadges(state: BadgeState): void {
  resetBadges(state);
  document.querySelectorAll<HTMLElement>('[data-badge-pos]').forEach((el) => delete el.dataset.badgePos);
  document.querySelectorAll(`.senkuro-copy-btn, .${UNPRICED_BADGE}`).forEach((el) => el.remove());
}

function updateBadges(state: BadgeState, db: Database, settings: Settings, cards?: Iterable<HTMLAnchorElement>): void {
  state.last = { db, settings };
  const shades = shadesOf(settings.opacity);
  const list = cards ?? document.querySelectorAll<HTMLAnchorElement>(CARD_LINK);
  const hasDatabase = isFilled(state, db);
  const batch = [...new Set(list)].flatMap((card) => measure(state, card, db, settings, hasDatabase) ?? []);
  const drawn = batch.filter(({ isUndrawn }) => !isUndrawn);
  drawn.forEach((item) => position(state, item));
  for (const item of drawn) if (item.holders.preview) item.gap = faceGap(item.holders.preview);
  for (const item of batch) show(state, item, settings, shades);
}

function refitCards(state: BadgeState, entries: ResizeObserverEntry[], watch: ResizeObserver): void {
  const stale = entries.flatMap(({ target }) => {
    if (!(target instanceof HTMLAnchorElement)) return [];
    if (!target.isConnected) {
      watch.unobserve(target);
      return [];
    }
    return bandOf(target.offsetWidth) === target.dataset.badgeBand ? [] : [target];
  });
  if (!state.last || stale.length === 0) return;
  stale.forEach((card) => delete card.dataset.priceBadgeAdded);
  updateBadges(state, state.last.db, state.last.settings, stale);
}

export function createPriceBadges({ touch }: { touch: boolean }): PriceBadges {
  const state: BadgeState = {
    touch,
    positioned: new WeakSet<HTMLElement>(),
    isFilledByDatabase: new WeakMap<Database, boolean>(),
    last: null,
    resizeWatch: null,
  };
  if (typeof ResizeObserver !== 'undefined') state.resizeWatch = new ResizeObserver((entries, watch) => refitCards(state, entries, watch));
  return {
    update: (db, settings, cards) => updateBadges(state, db, settings, cards),
    reset: () => resetBadges(state),
    resetPage: () => resetPageBadges(state),
  };
}
