export const CARD_LINK = 'a.card-collect';
export const CARD_ROW_CLASS = 'card-collect-preview';
export const PRICE_DECIMALS = 2;
export const COMMISSION_SHARE_KEPT = 0.8;
export const PERCENT = 100;

export const effectivePrice = (price: number, commission: boolean): number => (commission ? price * COMMISSION_SHARE_KEPT : price);

export const slugFromHref = (href: string | null | undefined): string | null => href?.split('/').pop() || null;

const SHOWN_NAME_IMAGE = ':scope > .card-collect__front > img.card-collect__img';

export const findShownName = (card: Element): string | null => card.querySelector<HTMLImageElement>(SHOWN_NAME_IMAGE)?.alt.trim() || null;
