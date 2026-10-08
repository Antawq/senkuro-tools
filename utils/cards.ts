const COMMISSION_SHARE_KEPT = 0.8;

export const effectivePrice = (price: number, commission: boolean): number => (commission ? price * COMMISSION_SHARE_KEPT : price);

export const slugFromHref = (href: string | null | undefined): string | null => href?.split('/').pop() || null;
