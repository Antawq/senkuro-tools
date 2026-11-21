import { isAppMounted } from '../shared/app-mounted';
import { childWithClass, element } from '../shared/dom';

export const RESET_CLASS = 'senkutools-catalog-reset';
export const RESET_TEXT = 'Сбросить фильтры';

const TITLE_CATALOG_PATH = /^\/browse\/(manga|anime)(\/|$)/;
const SITE_RESET = '.catalog-filter__header button[aria-label="Сбросить"]';
const SITE_DIRTY_CLASS = 'button--chip';
const RESET_HOSTS = ['.catalog-cnt__nav', '.catalog-cnt > .empty'];
const SITE_BUTTON = 'button button--secondary button--auto button-size--md';

const findSiteReset = (pageDocument: Document): HTMLButtonElement | null => pageDocument.querySelector<HTMLButtonElement>(SITE_RESET);

const isTitleCatalog = (pageDocument: Document): boolean => TITLE_CATALOG_PATH.test(pageDocument.defaultView?.location.pathname ?? '');

const isFiltered = (pageDocument: Document): boolean =>
  isAppMounted(pageDocument) && isTitleCatalog(pageDocument) && findSiteReset(pageDocument)?.classList.contains(SITE_DIRTY_CLASS) === true;

const hostsOf = (pageDocument: Document): Element[] => RESET_HOSTS.flatMap((selector) => [...pageDocument.querySelectorAll(selector)]);

function createResetButton(pageDocument: Document): HTMLButtonElement {
  const button = element('button', `${SITE_BUTTON} ${RESET_CLASS}`, RESET_TEXT);
  button.type = 'button';
  button.addEventListener('click', () => findSiteReset(pageDocument)?.click());
  return button;
}

export function syncCatalogReset(pageDocument: Document): void {
  const shouldShow = isFiltered(pageDocument);
  const hosts = shouldShow ? hostsOf(pageDocument) : [];
  for (const button of pageDocument.querySelectorAll(`.${RESET_CLASS}`)) {
    if (!button.parentElement || !hosts.includes(button.parentElement)) button.remove();
  }
  for (const host of hosts) {
    if (!childWithClass(host, RESET_CLASS)) host.append(createResetButton(pageDocument));
  }
}

export function isCatalogResetStale(pageDocument: Document): boolean {
  const shown = pageDocument.querySelectorAll(`.${RESET_CLASS}`).length;
  if (!isFiltered(pageDocument)) return shown > 0;
  return hostsOf(pageDocument).some((host) => !childWithClass(host, RESET_CLASS));
}
