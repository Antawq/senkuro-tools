import { isAppMounted } from '../shared/app-mounted';
import { createRefreshButton } from '../shared/refresh-button';
import type { RefreshOutcome } from '../shared/refresh-signal';
import { extractProfileSlug } from './profile-cards';
import { warnStoreFailure } from './profile-store';

export const REFRESH_BUTTON_ID = 'senkutools-inventory-refresh';

const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
const FILTERS = '.user-card__filters';
const HEADER = 'header.back';
const TITLE = 'h2';

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

function createProfileRefreshButton(slug: string, host: RefreshHost): HTMLButtonElement {
  const button = createRefreshButton(async () => (await refreshProfile(slug, host)) !== 'nothing');
  button.id = REFRESH_BUTTON_ID;
  button.dataset.senkutoolsSlug = slug;
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
  cardsTitle.after(createProfileRefreshButton(slug, host));
}

export const isRefreshButtonMissing = (): boolean =>
  Boolean(findCardsSlug() && findCardsTitle() && !document.getElementById(REFRESH_BUTTON_ID) && isAppMounted(document));
