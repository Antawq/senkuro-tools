export const FAST_PAGES = 10;
export const FAST_DELAY_MS = 0;
export const THROTTLED_DELAY_MS = 180;

export const delayForPage = (page: number): number => (page < FAST_PAGES ? FAST_DELAY_MS : THROTTLED_DELAY_MS);
