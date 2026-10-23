import { isAppMounted } from '../shared/app-mounted';
import { element } from '../shared/dom';
import { refreshIcon } from '../shared/svg';
import { extractProfileSlug } from './profile-cards';
import { warnStoreFailure } from './profile-store';

export const REFRESH_BUTTON_ID = 'senkuro-inventory-refresh';

const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
const FILTERS = '.user-card__filters';
const HEADER = 'header.back';
const TITLE = 'h2';
const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const ICON_SIZE_PX = 20;
const LABEL = 'Обновить инвентарь';

export interface RefreshHost {
  forget: (slug: string) => Promise<void>;
  reload: () => void;
}

const findCardsSlug = (): string | null => (CARDS_PATH.test(window.location.pathname) ? extractProfileSlug(window.location.pathname) : null);

const findCardsTitle = (): Element | null => document.querySelector(FILTERS)?.closest(HEADER)?.querySelector(TITLE) ?? null;

function createRefreshButton(slug: string, host: RefreshHost): HTMLButtonElement {
  const button = element('button', SITE_BUTTON);
  button.type = 'button';
  button.id = REFRESH_BUTTON_ID;
  button.dataset.slug = slug;
  button.title = LABEL;
  button.setAttribute('aria-label', LABEL);
  const icon = refreshIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', () => {
    button.disabled = true;
    void host
      .forget(slug)
      .catch(warnStoreFailure)
      .then(() => host.reload());
  });
  return button;
}

export function syncRefreshButton(host: RefreshHost): void {
  const slug = findCardsSlug();
  const cardsTitle = findCardsTitle();
  const existingButton = document.getElementById(REFRESH_BUTTON_ID);
  const canPlaceButton = slug !== null && cardsTitle !== null;
  if (canPlaceButton && existingButton?.dataset.slug === slug) return;
  existingButton?.remove();
  if (!canPlaceButton || !isAppMounted(document)) return;
  cardsTitle.after(createRefreshButton(slug, host));
}

export const isRefreshButtonMissing = (): boolean =>
  Boolean(findCardsSlug() && findCardsTitle() && !document.getElementById(REFRESH_BUTTON_ID) && isAppMounted(document));
