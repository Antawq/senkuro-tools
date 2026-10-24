import { isAppMounted } from '../shared/app-mounted';
import { element } from '../shared/dom';
import type { RefreshOutcome } from '../shared/refresh-signal';
import { refreshIcon } from '../shared/svg';
import { extractProfileSlug } from './profile-cards';
import { warnStoreFailure } from './profile-store';

export const REFRESH_BUTTON_ID = 'senkutools-inventory-refresh';

const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
const FILTERS = '.user-card__filters';
const HEADER = 'header.back';
const TITLE = 'h2';
const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const ICON_SIZE_PX = 20;

export interface RefreshHost {
  isReady: () => boolean;
  refresh: () => Promise<RefreshOutcome>;
  forget: (slug: string) => Promise<void>;
  reload: () => void;
  redraw: () => void;
}

const findCardsSlug = (): string | null => (CARDS_PATH.test(window.location.pathname) ? extractProfileSlug(window.location.pathname) : null);

const findCardsTitle = (): Element | null => document.querySelector(FILTERS)?.closest(HEADER)?.querySelector(TITLE) ?? null;

async function refreshProfile(slug: string, host: RefreshHost): Promise<RefreshOutcome> {
  const outcome = host.isReady() ? await host.refresh() : 'nothing';
  if (outcome === 'failed') return outcome;
  await host.forget(slug).catch(warnStoreFailure);
  if (outcome === 'nothing') host.reload();
  else host.redraw();
  return outcome;
}

function createRefreshButton(slug: string, host: RefreshHost): HTMLButtonElement {
  const button = element('button', SITE_BUTTON);
  button.type = 'button';
  button.id = REFRESH_BUTTON_ID;
  button.dataset.senkutoolsSlug = slug;
  const icon = refreshIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    void refreshProfile(slug, host).then((outcome) => {
      if (outcome === 'nothing') return;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  });
  return button;
}

export function syncRefreshButton(host: RefreshHost): void {
  const slug = findCardsSlug();
  const cardsTitle = findCardsTitle();
  const existingButton = document.getElementById(REFRESH_BUTTON_ID);
  const canPlaceButton = slug !== null && cardsTitle !== null;
  if (canPlaceButton && existingButton?.dataset.senkutoolsSlug === slug) return;
  existingButton?.remove();
  if (!canPlaceButton || !isAppMounted(document)) return;
  cardsTitle.after(createRefreshButton(slug, host));
}

export const isRefreshButtonMissing = (): boolean =>
  Boolean(findCardsSlug() && findCardsTitle() && !document.getElementById(REFRESH_BUTTON_ID) && isAppMounted(document));
