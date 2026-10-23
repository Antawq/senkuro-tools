import { isAppMounted } from '../shared/app-mounted';
import { element } from '../shared/dom';
import { refreshIcon } from '../shared/svg';
import { decodeSafely } from '../shared/uri';
import { warnStore } from './profile-store';

export const REFRESH_BUTTON_ID = 'senkuro-inventory-refresh';

const CARDS_PATH = /^\/users\/([^/?#]+)\/cards\/?$/;
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

function cardsSlug(): string | null {
  const slug = decodeSafely(CARDS_PATH.exec(window.location.pathname)?.[1] ?? '').trim();
  return slug || null;
}

const cardsHeader = (): Element | null => document.querySelector(FILTERS)?.closest(HEADER) ?? null;

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
    button.setAttribute('aria-busy', 'true');
    void deps
      .forget(slug)
      .catch(warnStore)
      .then(() => deps.reload());
  });
  return button;
}

export function syncRefreshButton(deps: RefreshDeps): void {
  const slug = cardsSlug();
  const header = cardsHeader();
  const existing = document.getElementById(REFRESH_BUTTON_ID);
  const place = slug !== null && header !== null;
  if (place && existing?.dataset.slug === slug) return;
  existing?.remove();
  if (!place || !isAppMounted(document)) return;
  const button = build(slug, deps);
  const title = header.querySelector(TITLE);
  if (title) title.after(button);
  else header.append(button);
}

export const refreshButtonMissing = (): boolean =>
  Boolean(cardsSlug() && cardsHeader() && !document.getElementById(REFRESH_BUTTON_ID) && isAppMounted(document));
