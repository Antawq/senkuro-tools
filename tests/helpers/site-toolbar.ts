export type FixtureKind = 'grid' | 'deck' | 'window';

export const SORT_FIELDS = ['RANK', 'QUANTITY', 'POPULARITY_SCORE', 'CHARACTER', 'ENTITY', 'CREATED_AT', 'UPDATED_AT'] as const;
export const RANKS = ['X', 'R', 'S', 'A', 'B', 'C', 'D', 'F'] as const;
export const COLORS = [
  'Белый',
  'Чёрный',
  'Серый',
  'Угольный',
  'Голубой',
  'Синий',
  'Тёмно-синий',
  'Бирюзовый',
  'Зелёный',
  'Красный',
  'Оранжевый',
  'Жёлтый',
] as const;
const SHOWN_COLORS = 8;

export interface SiteState {
  sort: string;
  direction: 'ASC' | 'DESC';
  ranks: Set<string>;
  colors: Set<string>;
  isAnimated: boolean;
  isExplicit: boolean;
  tab: 'Карты' | 'Осколки';
  isColorsExpanded: boolean;
}

export interface SiteToolbar {
  toolbar: HTMLElement;
  state: SiteState;
  clicks: string[];
  dispose: () => void;
}

const NO_STATE = (): SiteState => ({
  sort: 'CREATED_AT',
  direction: 'DESC',
  ranks: new Set(),
  colors: new Set(),
  isAnimated: false,
  isExplicit: false,
  tab: 'Карты',
  isColorsExpanded: false,
});

const popperButton = (label: string): string =>
  `<div class="v-popper v-popper--theme-dropdown"><button type="button" class="button button--secondary"><span>${label}</span></button></div>`;

const directionHtml = (kind: FixtureKind): string =>
  `<button type="button" class="button button--secondary${kind === 'grid' ? ' button--icon' : ''}" data-fixture="direction">${kind === 'grid' ? '' : '<span>Сначала</span>'}</button>`;

const TOOLBARS: Record<FixtureKind, (sortLabel: string) => string> = {
  grid: (label) =>
    `<section><header><div class="user-card__filters">${directionHtml('grid')}${popperButton(label)}${popperButton('Фильтр')}</div></header><div class="tabs tabs--segment"><div class="tabs-inner"><div class="tabs-cnt"><button type="button" class="tabs-tab tabs-tab--active button">Карты</button><button type="button" class="tabs-tab button">Осколки</button></div></div></div></section>`,
  deck: (label) =>
    `<div class="card-browse"><div class="card-browse__form">${popperButton(label)}${directionHtml('deck')}${popperButton('Фильтр')}</div></div>`,
  window: (label) =>
    `<div class="modal-content modal-content--trade"><header class="modal-trade__header"><div><div>Твои карточки</div><div class="modal-trade__header-hint">Выбери до 50 карт, которые готов отдать взамен</div></div></header><div class="modal-trade__body"><div class="modal-trade__header-form">${popperButton(label)}${directionHtml('window')}${popperButton('Фильтр')}</div><div class="modal-trade__body-result"></div></div></div>`,
};

const TOOLBAR_SELECTORS: Record<FixtureKind, string> = { grid: '.user-card__filters', deck: '.card-browse__form', window: '.modal-trade__header-form' };
const FILTER_IDS: Record<FixtureKind, string> = { grid: 'trade-filter', deck: 'cards-browse-filter', window: 'trade-filter' };

const tag = (text: string, isActive: boolean): string => `<button type="button" class="button${isActive ? ' button--active' : ''}">${text}</button>`;

const switchHtml = (text: string, isOn: boolean): string =>
  `<label class="switch switch-size--md${isOn ? ' switch--active' : ''}"><input type="checkbox"${isOn ? ' checked=""' : ''}><span class="switch__label">${text}</span></label>`;

function renderFilter(kind: FixtureKind, state: SiteState): string {
  const colors = state.isColorsExpanded ? COLORS : COLORS.slice(0, SHOWN_COLORS);
  const spoiler = state.isColorsExpanded ? '' : 'dropdown-filter__tags--spoiler ';
  return `<div id="${FILTER_IDS[kind]}" class="v-popper__popper"><div class="dropdown-menu dropdown-menu--scroll dropdown-menu--lg"><div class="dropdown-filter__header"><div class="dropdown-filter__caption">Фильтр</div><div class="dropdown-filter__actions"><button type="button" class="button button--icon" data-fixture="reset"></button><button type="button" class="button button--icon" data-fixture="close"></button></div></div><div class="dropdown-filter__body"><div><div class="dropdown-filter__label">Ранги</div><div class="dropdown-filter__tags">${RANKS.map((rank) => tag(rank, state.ranks.has(rank))).join('')}</div></div><div><div class="dropdown-filter__label">Цвета</div><div class="${spoiler}dropdown-filter__tags">${colors.map((color) => tag(color, state.colors.has(color))).join('')}</div><button type="button" class="button" data-fixture="expand">${state.isColorsExpanded ? 'Свернуть' : 'Развернуть'}</button></div><div><div class="dropdown-filter__label">Прочее</div>${switchHtml('Только анимированные', state.isAnimated)}${switchHtml('Только 18+', state.isExplicit)}</div></div></div></div>`;
}

function renderMenu(state: SiteState): string {
  const items = SORT_FIELDS.map(
    (field) =>
      `<label class="radio radio-size--md radio--list"><input type="radio" value="${field}"${state.sort === field ? ' checked=""' : ''}><span>${field}</span></label>`
  ).join('');
  return `<div id="cards-browse-order" class="v-popper__popper"><div class="dropdown-menu dropdown-menu--sm"><div class="dropdown-menu__caption">Сортировать по</div>${items}</div></div>`;
}

const setPopper = (id: string, html: string | null): void => {
  document.getElementById(id)?.remove();
  for (const trigger of document.querySelectorAll(`[aria-describedby="${id}"]`)) {
    trigger.removeAttribute('aria-describedby');
    trigger.removeAttribute('data-popper-shown');
  }
  if (html) document.body.insertAdjacentHTML('beforeend', html);
};

const markOpen = (trigger: Element | undefined, id: string): void => {
  trigger?.setAttribute('aria-describedby', id);
  trigger?.setAttribute('data-popper-shown', '');
};

function repaintTags(popper: Element, state: SiteState): void {
  const [ranks, colors] = popper.querySelectorAll('.dropdown-filter__tags');
  for (const button of ranks?.querySelectorAll('button') ?? []) button.classList.toggle('button--active', state.ranks.has(button.textContent ?? ''));
  for (const button of colors?.querySelectorAll('button') ?? []) button.classList.toggle('button--active', state.colors.has(button.textContent ?? ''));
}

function expandColors(popper: Element, state: SiteState): void {
  const colors = popper.querySelectorAll('.dropdown-filter__tags')[1];
  state.isColorsExpanded = !state.isColorsExpanded;
  colors?.classList.toggle('dropdown-filter__tags--spoiler', !state.isColorsExpanded);
  if (state.isColorsExpanded)
    colors?.insertAdjacentHTML(
      'beforeend',
      COLORS.slice(SHOWN_COLORS)
        .map((color) => tag(color, state.colors.has(color)))
        .join('')
    );
  else for (const button of [...(colors?.querySelectorAll('button') ?? [])].slice(SHOWN_COLORS)) button.remove();
  const expander = popper.querySelector('[data-fixture="expand"]');
  if (expander) expander.textContent = state.isColorsExpanded ? 'Свернуть' : 'Развернуть';
}

function bindFilter(kind: FixtureKind, state: SiteState, clicks: string[], signal: AbortSignal): void {
  const selector = `#${FILTER_IDS[kind]}`;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const popper = target?.closest(selector);
      const button = target?.closest('button');
      if (!popper || !button) return;
      const action = button.getAttribute('data-fixture');
      const label = button.textContent?.trim() ?? '';
      if (action === 'close') return setPopper(FILTER_IDS[kind], null);
      if (action === 'expand') return expandColors(popper, state);
      if (action === 'reset') {
        state.ranks.clear();
        state.colors.clear();
        if (kind === 'grid') {
          state.isAnimated = false;
          state.isExplicit = false;
          for (const input of popper.querySelectorAll<HTMLInputElement>('.switch input')) {
            input.checked = false;
            input.closest('label')?.classList.remove('switch--active');
          }
        }
        clicks.push('reset');
      } else if (popper.querySelector('.dropdown-filter__tags')?.contains(button)) toggle(state.ranks, label, clicks);
      else toggle(state.colors, label, clicks);
      repaintTags(popper, state);
    },
    { signal }
  );
  document.addEventListener(
    'change',
    (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input?.closest(selector)) return;
      const text = input.closest('label')?.textContent ?? '';
      if (text.includes('анимир')) state.isAnimated = input.checked;
      else state.isExplicit = input.checked;
      input.closest('label')?.classList.toggle('switch--active', input.checked);
      clicks.push(`switch:${text.trim()}`);
    },
    { signal }
  );
}

function toggle(set: Set<string>, value: string, clicks: string[]): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
  clicks.push(`tag:${value}`);
}

const sortLabelOf = (state: SiteState): string => `По ${state.sort}`;

export function mountSiteToolbar(kind: FixtureKind, overrides: Partial<SiteState> = {}): SiteToolbar {
  const state = { ...NO_STATE(), ...overrides };
  const clicks: string[] = [];
  const controller = new AbortController();
  const { signal } = controller;
  document.body.innerHTML = TOOLBARS[kind](sortLabelOf(state));
  const toolbar = document.querySelector<HTMLElement>(TOOLBAR_SELECTORS[kind]);
  if (!toolbar) throw new Error(`no toolbar for ${kind}`);
  const triggers = [...toolbar.querySelectorAll<HTMLElement>(':scope > .v-popper > button')];
  const [sortTrigger, filterTrigger] = triggers;
  const direction = toolbar.querySelector<HTMLElement>(':scope > button');
  const paintDirection = (): void => void direction?.classList.toggle('cards-cnt__nav-filter--asc', state.direction === 'ASC');
  paintDirection();
  sortTrigger?.addEventListener(
    'click',
    () => {
      setPopper('cards-browse-order', renderMenu(state));
      markOpen(sortTrigger, 'cards-browse-order');
    },
    { signal }
  );
  filterTrigger?.addEventListener(
    'click',
    () => {
      setPopper(FILTER_IDS[kind], renderFilter(kind, state));
      markOpen(filterTrigger, FILTER_IDS[kind]);
    },
    { signal }
  );
  direction?.addEventListener(
    'click',
    () => {
      state.direction = state.direction === 'ASC' ? 'DESC' : 'ASC';
      clicks.push('direction');
      paintDirection();
    },
    { signal }
  );
  document.addEventListener(
    'click',
    (event) => {
      const input = event.target instanceof HTMLInputElement && event.target.closest('#cards-browse-order') ? event.target : null;
      if (!input) return;
      state.sort = input.value;
      clicks.push(`sort:${input.value}`);
      const label = sortTrigger?.querySelector('span');
      if (label) label.textContent = sortLabelOf(state);
      setPopper('cards-browse-order', null);
    },
    { signal }
  );
  const paintTabs = (): void => {
    for (const other of toolbar.closest('section')?.querySelectorAll('.tabs-tab') ?? [])
      other.classList.toggle('tabs-tab--active', other.textContent === state.tab);
  };
  paintTabs();
  for (const tab of toolbar.closest('section')?.querySelectorAll<HTMLElement>('.tabs-tab') ?? []) {
    tab.addEventListener(
      'click',
      () => {
        state.tab = tab.textContent === 'Осколки' ? 'Осколки' : 'Карты';
        clicks.push(`tab:${state.tab}`);
        paintTabs();
      },
      { signal }
    );
  }
  bindFilter(kind, state, clicks, signal);
  return { toolbar, state, clicks, dispose: () => controller.abort() };
}
