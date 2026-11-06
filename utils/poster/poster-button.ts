import { isAppMounted } from '../shared/app-mounted';
import { element } from '../shared/dom';
import { posterIcon } from '../shared/svg';
import { createToolbarControls, type ToolbarControl } from '../shared/toolbar-controls';
import { createPanelShell, setPanelOpen } from '../shared/toolbar-panel';
import { USER_CARD_FILTERS } from '../shared/user-card-filters';
import { canSelectCards, countSelectedRows, profileSlugOf, readSelectedCards, type SelectedCard } from './poster-cards';

export const POSTER_BUTTON_TEXT = {
  label: 'Постер',
  howToSelect: 'Зажмите карту или выберите «Выделить всё» в меню «...»',
  onlyShards: 'Выбраны только осколки, для постера нужны карты',
} as const;

export const POSTER_CONTROL_CLASS = 'senkutools-poster__control';

const TRIGGER_CLASS = 'senkutools-poster__trigger';
const PANEL_CLASS = 'senkutools-poster__panel';
const HINT_CLASS = 'senkutools-poster__hint';
const SITE_ICON_BUTTON = 'button button--secondary button--icon button-size--md';
const SITE_APPLIED = 'button--chip';
const SITE_MENU = 'dropdown-menu dropdown-menu--md';
const CARDS_PATH = /^\/users\/[^/?#]+\/cards\/?$/;
const GRID = '.user-cards-grid';
const ICON_SIZE_PX = 20;

export interface PosterButtonHost {
  openDialog: (cards: readonly SelectedCard[], profileSlug: string) => void;
}

interface PosterControl extends ToolbarControl {
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  hint: HTMLElement;
  slug: string;
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

function press(control: PosterControl, host: PosterButtonHost, pageDocument: Document): void {
  const cards = readSelectedCards(pageDocument);
  if (cards.length > 0) {
    setPanelOpen(control.panel, control.trigger, false);
    host.openDialog(cards, control.slug);
    return;
  }
  control.hint.textContent = countSelectedRows(pageDocument) === 0 ? POSTER_BUTTON_TEXT.howToSelect : POSTER_BUTTON_TEXT.onlyShards;
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
  const control: PosterControl = { wrapper, trigger, panel, hint, slug };
  trigger.addEventListener('click', () => press(control, host, pageDocument));
  return control;
}

const markSelection = (control: PosterControl, pageDocument: Document): void =>
  void control.trigger.classList.toggle(SITE_APPLIED, countSelectedRows(pageDocument) > 0);

function stopWatchingSelection(): void {
  selectionWatch?.observer.disconnect();
  selectionWatch = null;
}

function watchSelection(control: PosterControl, pageDocument: Document): void {
  markSelection(control, pageDocument);
  const grid = pageDocument.querySelector(GRID);
  if (!grid) return stopWatchingSelection();
  if (selectionWatch?.grid === grid && selectionWatch.control === control) return;
  stopWatchingSelection();
  const observer = new MutationObserver(() => markSelection(control, pageDocument));
  observer.observe(grid, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  selectionWatch = { grid, control, observer };
}

function removePlacedControl(): void {
  if (placedToolbar) controls.remove(placedToolbar);
  placedToolbar = null;
  stopWatchingSelection();
}

function findPlace(pageDocument: Document): { toolbar: Element; slug: string } | null {
  const slug = cardsSlugOf(window.location.pathname);
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
  placedToolbar = toolbar;
  watchSelection(control, pageDocument);
}

export const isPosterButtonMissing = (pageDocument: Document): boolean => {
  const place = findPlace(pageDocument);
  return place !== null && findOwnControl(place.toolbar) === null;
};
