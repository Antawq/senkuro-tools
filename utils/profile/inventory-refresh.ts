import { isAppMounted } from '../shared/app-mounted';
import { element } from '../shared/dom';
import { refreshIcon } from '../shared/svg';
import { extractProfileSlug } from './profile-cards';
import { warnStore } from './profile-store';

export const REFRESH_BUTTON_ID = 'senkuro-inventory-refresh';

const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
const FILTERS = '.user-card__filters';
const HEADER = 'header.back';
const TITLE = 'h2';
const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const ICON_SIZE = 20;
const LABEL = 'Обновить инвентарь';

export interface RefreshDeps {
  forget: (slug: string) => Promise<void>;
  reload: () => void;
}

const cardsSlug = (): string | null => (CARDS_PATH.test(window.location.pathname) ? extractProfileSlug(window.location.pathname) : null);

const cardsTitle = (): Element | null => document.querySelector(FILTERS)?.closest(HEADER)?.querySelector(TITLE) ?? null;

function build(slug: string, deps: RefreshDeps): HTMLButtonElement {
  const button = element('button', SITE_BUTTON);
  button.type = 'button';
  button.id = REFRESH_BUTTON_ID;
  button.dataset.slug = slug;
  button.title = LABEL;
  button.setAttribute('aria-label', LABEL);
  const icon = refreshIcon(ICON_SIZE);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', () => {
    button.disabled = true;
    void deps
      .forget(slug)
      .catch(warnStore)
      .then(() => deps.reload());
  });
  return button;
}

export function syncRefreshButton(deps: RefreshDeps): void {
  const slug = cardsSlug();
  const title = cardsTitle();
  const existing = document.getElementById(REFRESH_BUTTON_ID);
  const place = slug !== null && title !== null;
  if (place && existing?.dataset.slug === slug) return;
  existing?.remove();
  if (!place || !isAppMounted(document)) return;
  title.after(build(slug, deps));
}

export const refreshButtonMissing = (): boolean =>
  Boolean(cardsSlug() && cardsTitle() && !document.getElementById(REFRESH_BUTTON_ID) && isAppMounted(document));
