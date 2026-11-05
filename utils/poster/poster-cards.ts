import { CARD_LINK, CARD_ROW_CLASS, slugFromHref } from '../shared/cards';
import { decodeSafely } from '../shared/uri';

export interface SelectedCard {
  slug: string;
  quantity: number;
}

export interface GridCard extends SelectedCard {
  isArtHidden: boolean;
}

export const SELECTED_ROW_SELECTOR = `.user-cards-grid > .${CARD_ROW_CLASS}.user-card--selected`;

const SHARD_ROW_CLASS = `${CARD_ROW_CLASS}--shard`;
const QUANTITY_TAG = `.${CARD_ROW_CLASS}__status .tag`;
const CARD_FRONT = ':scope > .card-collect__front';
const SHOWN_ART = 'img.card-collect__img, video';
const LEADING_COUNT = /^\d+/;
const MORE_OPTIONS_BUTTON = 'button[aria-label="more options"]';
const PROFILE_PATH = /^\/users\/([^/?#]+)/;
const RESERVED_PATHS = ['settings', 'notifications', 'card-trades'];

const quantityOf = (row: Element): number => {
  const match = LEADING_COUNT.exec(row.querySelector(QUANTITY_TAG)?.textContent?.trim() ?? '');
  return match ? Number(match[0]) : 1;
};

const isArtHiddenIn = (link: Element | null): boolean => !link?.querySelector(CARD_FRONT)?.querySelector(SHOWN_ART);

export function readSelectedCards(pageDocument: Document): GridCard[] {
  return [...pageDocument.querySelectorAll(SELECTED_ROW_SELECTOR)].flatMap((row) => {
    if (row.classList.contains(SHARD_ROW_CLASS)) return [];
    const link = row.querySelector(CARD_LINK);
    const slug = slugFromHref(link?.getAttribute('href'));
    return slug ? [{ slug, quantity: quantityOf(row), isArtHidden: isArtHiddenIn(link) }] : [];
  });
}

export const canSelectCards = (toolbar: Element): boolean => toolbar.querySelector(MORE_OPTIONS_BUTTON) !== null;

export function profileSlugOf(pathname: string): string | null {
  const match = PROFILE_PATH.exec(pathname);
  if (!match) return null;
  const slug = decodeSafely(match[1] ?? '').trim();
  if (!slug || RESERVED_PATHS.includes(slug)) return null;
  return slug;
}
