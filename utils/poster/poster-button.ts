import { isAppMounted } from '../shared/app-mounted';
import { CARD_ROW_CLASS } from '../shared/cards';
import { SITE_ICON_BUTTON, element } from '../shared/dom';
import { posterIcon } from '../shared/svg';
import { createToolbarControls, type ToolbarControl } from '../shared/toolbar-controls';
import { createPanelShell, setPanelOpen } from '../shared/toolbar-panel';
import { USER_CARD_FILTERS } from '../shared/user-card-filters';
import { canSelectCards, countSelectedRows, profileSlugOf, readSelectedCards, type SelectedCard } from './poster-cards';

export const POSTER_BUTTON_TEXT = {
  label: 'Постер',
  howToSelect: 'Зажмите карту или выберите «Выделить всё» в меню «...»',
} as const;

export const POSTER_CONTROL_CLASS = 'senkutools-poster__control';

const TRIGGER_CLASS = 'senkutools-poster__trigger';
const PANEL_CLASS = 'senkutools-poster__panel';
const HINT_CLASS = 'senkutools-poster__hint';
const SITE_APPLIED = 'button--chip';
const SITE_MENU = 'dropdown-menu dropdown-menu--md';
const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
const GRID = '.user-cards-grid';
const CARD_ROW = `:scope > .${CARD_ROW_CLASS}:not(.${CARD_ROW_CLASS}--shard)`;
const SHARD_ROW = `:scope > .${CARD_ROW_CLASS}.${CARD_ROW_CLASS}--shard`;
const USER_ACTIONS_ID = 'user-actions';
const ICON_SIZE_PX = 20;

export interface PosterButtonHost {
  openDialog: (cards: readonly SelectedCard[], profileSlug: string) => void;
}

interface PosterControl extends ToolbarControl {
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  hint: HTMLElement;
  slug: string;
  cards: SelectedCard[];
  shards: SelectedCard[];
  hadUserActions: boolean;
}

interface SelectionWatch {
  grid: Element;
  control: PosterControl;
  observer: MutationObserver;
}

const controls = createToolbarControls<PosterControl>();
let placedToolbar: Element | null = null;
let selectionWatch: SelectionWatch | null = null;

const cardsSlugOf = (pathname: string): string | null => (CARDS_PATH.test(pathname) ? profileSlugOf(pathname) : null);

const findOwnControl = (toolbar: Element): HTMLElement | null => toolbar.querySelector<HTMLElement>(`:scope > .${POSTER_CONTROL_CLASS}`);

function syncSelection(control: PosterControl, pageDocument: Document): SelectedCard[] {
  const hasUserActions = pageDocument.getElementById(USER_ACTIONS_ID) !== null;
  if (control.hadUserActions && !hasUserActions) {
    control.cards = [];
    control.shards = [];
  }
  control.hadUserActions = hasUserActions;
  const grid = pageDocument.querySelector(GRID);
  const hasCardRows = Boolean(grid?.querySelector(CARD_ROW));
  const hasShardRows = Boolean(grid?.querySelector(SHARD_ROW));
  const current = readSelectedCards(pageDocument);
  if (hasCardRows && hasShardRows) {
    control.cards = current.filter((card) => !card.shard);
    control.shards = current.filter((card) => Boolean(card.shard));
    control.trigger.classList.toggle(SITE_APPLIED, current.length > 0 || countSelectedRows(pageDocument) > 0);
    return current;
  }
  if (hasCardRows) control.cards = current;
  else if (hasShardRows) control.shards = current;
  else if (!hasUserActions) {
    control.cards = [];
    control.shards = [];
  }
  const combined = [...control.cards, ...control.shards];
  control.trigger.classList.toggle(SITE_APPLIED, combined.length > 0 || countSelectedRows(pageDocument) > 0);
  return combined;
}

function press(control: PosterControl, host: PosterButtonHost, pageDocument: Document): void {
  const cards = syncSelection(control, pageDocument);
  if (cards.length > 0) {
    setPanelOpen(control.panel, control.trigger, false);
    host.openDialog(cards, control.slug);
    return;
  }
  control.hint.textContent = POSTER_BUTTON_TEXT.howToSelect;
  setPanelOpen(control.panel, control.trigger, Boolean(control.panel.hidden));
}

function createControl(slug: string, host: PosterButtonHost, pageDocument: Document): PosterControl {
  const wrapper = element('div', POSTER_CONTROL_CLASS);
  wrapper.dataset.senkutoolsSlug = slug;
  const trigger = element('button', `${SITE_ICON_BUTTON} ${TRIGGER_CLASS}`);
  trigger.type = 'button';
  trigger.title = POSTER_BUTTON_TEXT.label;
  trigger.setAttribute('aria-label', POSTER_BUTTON_TEXT.label);
  trigger.setAttribute('aria-expanded', 'false');
  const icon = posterIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  trigger.append(icon);
  const hint = element('p', HINT_CLASS);
  const menu = element('div', SITE_MENU);
  menu.append(hint);
  const panel = createPanelShell(PANEL_CLASS, menu);
  wrapper.append(trigger, panel);
  const control: PosterControl = { wrapper, trigger, panel, hint, slug, cards: [], shards: [], hadUserActions: false };
  trigger.addEventListener('click', () => press(control, host, pageDocument));
  return control;
}

function stopWatchingSelection(): void {
  selectionWatch?.observer.disconnect();
  selectionWatch = null;
}

function watchSelection(control: PosterControl, pageDocument: Document): void {
  syncSelection(control, pageDocument);
  const grid = pageDocument.querySelector(GRID);
  if (!grid) return stopWatchingSelection();
  if (selectionWatch?.grid === grid && selectionWatch.control === control) return;
  stopWatchingSelection();
  const observer = new MutationObserver(() => void syncSelection(control, pageDocument));
  observer.observe(grid, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  selectionWatch = { grid, control, observer };
}

function removePlacedControl(): void {
  if (placedToolbar) controls.remove(placedToolbar);
  placedToolbar = null;
  stopWatchingSelection();
}

function findPlace(pageDocument: Document): { toolbar: Element; slug: string } | null {
  const slug = cardsSlugOf(pageDocument.location.pathname);
  const toolbar = pageDocument.querySelector(USER_CARD_FILTERS);
  return slug !== null && toolbar !== null && canSelectCards(toolbar) && isAppMounted(pageDocument) ? { toolbar, slug } : null;
}

export function syncPosterButton(pageDocument: Document, host: PosterButtonHost): void {
  const place = findPlace(pageDocument);
  if (!place) return removePlacedControl();
  const { toolbar, slug } = place;
  if (placedToolbar && placedToolbar !== toolbar) removePlacedControl();
  if (findOwnControl(toolbar)?.dataset.senkutoolsSlug !== slug) controls.remove(toolbar);
  const control = controls.place(toolbar, () => createControl(slug, host, pageDocument), []);
  for (const duplicate of toolbar.querySelectorAll<HTMLElement>(`:scope > .${POSTER_CONTROL_CLASS}`)) {
    if (duplicate !== control.wrapper) duplicate.remove();
  }
  placedToolbar = toolbar;
  watchSelection(control, pageDocument);
}

export const isPosterButtonMissing = (pageDocument: Document): boolean => {
  const place = findPlace(pageDocument);
  return place !== null && findOwnControl(place.toolbar) === null;
};
