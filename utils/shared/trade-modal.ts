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
