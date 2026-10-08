const COMMISSION_SHARE_KEPT = 0.8;

export const effectivePrice = (price, commission) => (commission ? price * COMMISSION_SHARE_KEPT : price);

export const slugFromHref = (href) => href?.split('/').pop() || null;
