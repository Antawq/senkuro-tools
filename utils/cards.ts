export const CARD_LINK = 'a.card-collect';
export const PRICE_DECIMALS = 2;
export const COMMISSION_SHARE_KEPT = 0.8;
export const PERCENT = 100;

export const effectivePrice = (price: number, commission: boolean): number => (commission ? price * COMMISSION_SHARE_KEPT : price);

export const slugFromHref = (href: string | null | undefined): string | null => href?.split('/').pop() || null;
