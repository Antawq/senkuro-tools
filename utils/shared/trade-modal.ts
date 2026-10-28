export const MODAL = '.modal-content--trade';
export const HEADER = '.modal-trade__header';
export const TOOLBAR = '.modal-trade__header-form';
export const RESULTS_CLASS = 'modal-trade__body-result';
export const CATALOG_STEP = 'из общего каталога';

export const isCatalogStep = (modal: Element): boolean => (modal.querySelector(HEADER)?.textContent ?? '').includes(CATALOG_STEP);
