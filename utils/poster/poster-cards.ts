import { CARD_LINK, CARD_ROW_CLASS, slugFromHref } from '../shared/cards';
import { decodeSafely } from '../shared/uri';

export interface SelectedCard {
  slug: string;
  quantity: number;
}

export const SELECTED_ROW_SELECTOR = `.user-cards-grid > .${CARD_ROW_CLASS}.user-card--selected`;

const SHARD_ROW_CLASS = `${CARD_ROW_CLASS}--shard`;
const QUANTITY_TAG = `.${CARD_ROW_CLASS}__status .tag`;
const LEADING_COUNT = /^\d+/;
const MORE_OPTIONS_BUTTON = 'button[aria-label="more options"]';
const PROFILE_PATH = /^\/users\/([^/?#]+)/;
const RESERVED_PATHS = ['settings', 'notifications', 'card-trades'];

const quantityOf = (row: Element): number => {
  const match = LEADING_COUNT.exec(row.querySelector(QUANTITY_TAG)?.textContent?.trim() ?? '');
  return match ? Number(match[0]) : 1;
};

export function readSelectedCards(pageDocument: Document): SelectedCard[] {
  return [...pageDocument.querySelectorAll(SELECTED_ROW_SELECTOR)].flatMap((row) => {
    if (row.classList.contains(SHARD_ROW_CLASS)) return [];
    const slug = slugFromHref(row.querySelector(CARD_LINK)?.getAttribute('href'));
    return slug ? [{ slug, quantity: quantityOf(row) }] : [];
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
