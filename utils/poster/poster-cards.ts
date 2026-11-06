import { CARD_LINK, CARD_ROW_CLASS, slugFromHref } from '../shared/cards';
import { decodeSafely } from '../shared/uri';

export interface SelectedCard {
  slug: string;
  quantity: number;
}

export const SELECTED_ROW_SELECTOR = `.user-cards-grid > .${CARD_ROW_CLASS}.user-card--selected`;

const SHARD_ROW_CLASS = `${CARD_ROW_CLASS}--shard`;
const QUANTITY_TAG = `.${CARD_ROW_CLASS}__status .tag`;
const MORE_OPTIONS_BUTTON = 'button[aria-label="more options"]';
const PROFILE_PATH = /^\/users\/([^/?#]+)/;
const RESERVED_PATHS = ['settings', 'notifications', 'card-trades'];

const quantityOf = (row: Element): number => {
  const count = Number.parseInt(String(row.querySelector(QUANTITY_TAG)?.textContent), 10);
  return Number.isNaN(count) ? 1 : count;
};

export function readSelectedCards(pageDocument: Document): SelectedCard[] {
  return [...pageDocument.querySelectorAll(SELECTED_ROW_SELECTOR)].flatMap((row) => {
    if (row.classList.contains(SHARD_ROW_CLASS)) return [];
    const link = row.querySelector(CARD_LINK);
    const slug = slugFromHref(link?.getAttribute('href'));
    return link && slug ? [{ slug, quantity: quantityOf(row) }] : [];
  });
}

export const countSelectedRows = (pageDocument: Document): number => pageDocument.querySelectorAll(SELECTED_ROW_SELECTOR).length;

export const canSelectCards = (toolbar: Element): boolean => toolbar.querySelector(MORE_OPTIONS_BUTTON) !== null;

export function profileSlugOf(pathname: string): string | null {
  const encodedSlug = PROFILE_PATH.exec(pathname)?.[1];
  if (encodedSlug === undefined) return null;
  const slug = decodeSafely(encodedSlug).trim();
  return slug && !RESERVED_PATHS.includes(slug) ? slug : null;
}
