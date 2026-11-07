export const MODAL = '.modal-content--trade';
export const HEADER = '.modal-trade__header';
export const TOOLBAR = '.modal-trade__header-form';
export const PICKER = '.modal-trade__body';
export const RESULTS_CLASS = 'modal-trade__body-result';
export const CATALOG_STEP = 'из общего каталога';
export const PARTNER_STEP = 'Выбор карточек';

const headerTextOf = (modal: Element): string => String(modal.querySelector(HEADER)?.textContent);

export const isCatalogStep = (modal: Element): boolean => headerTextOf(modal).includes(CATALOG_STEP);

export const isUserCardsStep = (modal: Element): boolean => modal.querySelector(`.${RESULTS_CLASS}`) !== null && !isCatalogStep(modal);

export const isPartnerStep = (modal: Element): boolean => isUserCardsStep(modal) && headerTextOf(modal).includes(PARTNER_STEP);

export type WindowMode = 'trade' | 'upgrade' | 'split' | 'merge';

const MODE_HINTS: readonly (readonly [string, WindowMode])[] = [
  ['для переплавки', 'upgrade'],
  ['для раскола', 'split'],
  ['для объединения', 'merge'],
  ['Выбери до', 'trade'],
];

export function windowModeOf(modal: Element): WindowMode | null {
  const header = headerTextOf(modal);
  if (header.includes(CATALOG_STEP)) return null;
  return MODE_HINTS.find(([hint]) => header.includes(hint))?.[1] ?? null;
}
