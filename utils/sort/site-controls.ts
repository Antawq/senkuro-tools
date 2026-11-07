import type { MemoryDirection, MemoryTab } from '../shared/filter-memory';
import type { FrameWait } from '../shared/frame-wait';
import { DIRECTION_ASCENDING, MENU, MENU_ITEM } from './sort-dom';

export interface DropdownState {
  ranks: string[];
  colors: string[];
  shownColors: string[];
  isAnimated: boolean;
  isExplicit: boolean;
}

export interface WantedFilters {
  ranks: readonly string[];
  colors: readonly string[];
  isAnimated: boolean;
  isExplicit: boolean;
}

const POPPER_TRIGGERS = ':scope > .v-popper > button';
const SORT_LABEL = /^(По |Сортировка)/;
const FILTER_LABEL = /^Фильтр/;
export const FILTER_BODY = '#trade-filter .dropdown-filter__body, #cards-browse-filter .dropdown-filter__body';
const TAGS = '.dropdown-filter__tags';
const SWITCH = '.switch';
const ACTIVE_TAG = 'button--active';
const CLOSE_BUTTON = '.dropdown-filter__actions button:last-child';
const EXPAND_LABEL = 'Развернуть';
const ANIMATED_MARK = 'анимир';
const EXPLICIT_MARK = '18+';
const TAB = '.tabs-tab';
const ACTIVE_TAB = 'tabs-tab--active';
const TAB_LABELS: Record<MemoryTab, string> = { cards: 'Карты', shards: 'Осколки' };
const TAB_AREA = 'section';

const textOf = (node: Element): string => node.textContent?.trim() ?? '';

const triggerLabeled = (toolbar: Element, label: RegExp): HTMLElement | null =>
  [...toolbar.querySelectorAll<HTMLElement>(POPPER_TRIGGERS)].find((button) => label.test(textOf(button))) ?? null;

export const sortTriggerOf = (toolbar: Element): HTMLElement | null => triggerLabeled(toolbar, SORT_LABEL);

export const filterTriggerOf = (toolbar: Element): HTMLElement | null => triggerLabeled(toolbar, FILTER_LABEL);

export const directionButtonOf = (toolbar: Element): HTMLElement | null => toolbar.querySelector<HTMLElement>(':scope > button');

export const readDirection = (toolbar: Element): MemoryDirection => (toolbar.querySelector(DIRECTION_ASCENDING) === null ? 'DESC' : 'ASC');

const activeTags = (container: Element | undefined): string[] =>
  [...(container?.querySelectorAll('button') ?? [])].filter((button) => button.classList.contains(ACTIVE_TAG)).map(textOf);

const shownTags = (container: Element | undefined): string[] => [...(container?.querySelectorAll('button') ?? [])].map(textOf);

const isSwitchOn = (body: Element, mark: string): boolean => {
  const control = [...body.querySelectorAll(SWITCH)].find((candidate) => textOf(candidate).includes(mark));
  return control?.querySelector('input')?.checked === true;
};

export function readDropdown(body: Element): DropdownState {
  const [ranks, colors] = body.querySelectorAll(TAGS);
  return {
    ranks: activeTags(ranks),
    colors: activeTags(colors),
    shownColors: shownTags(colors),
    isAnimated: isSwitchOn(body, ANIMATED_MARK),
    isExplicit: isSwitchOn(body, EXPLICIT_MARK),
  };
}

export const isResetClick = (target: Element): boolean => target.closest('.dropdown-filter__actions button:first-child') !== null;

export function readTab(toolbar: Element): MemoryTab | null {
  const tabs = [...(toolbar.closest(TAB_AREA)?.querySelectorAll(TAB) ?? [])];
  const active = tabs.find((tab) => tab.classList.contains(ACTIVE_TAB));
  return active ? ((Object.keys(TAB_LABELS) as MemoryTab[]).find((tab) => TAB_LABELS[tab] === textOf(active)) ?? null) : null;
}

export async function chooseSort(pageDocument: Document, toolbar: Element, field: string, wait: FrameWait): Promise<boolean> {
  const trigger = sortTriggerOf(toolbar);
  if (!trigger) return false;
  trigger.click();
  const item = await wait(() => [...pageDocument.querySelectorAll<HTMLInputElement>(`${MENU} ${MENU_ITEM} input`)].find((input) => input.value === field));
  item?.click();
  return item !== null;
}

export function flipDirection(toolbar: Element): boolean {
  const button = directionButtonOf(toolbar);
  button?.click();
  return button !== null;
}

export function chooseTab(toolbar: Element, tab: MemoryTab): boolean {
  const target = [...(toolbar.closest(TAB_AREA)?.querySelectorAll<HTMLElement>(TAB) ?? [])].find((candidate) => textOf(candidate) === TAB_LABELS[tab]);
  target?.click();
  return target !== undefined;
}

const tagIn = (container: Element | undefined, label: string): HTMLElement | undefined =>
  [...(container?.querySelectorAll<HTMLElement>('button') ?? [])].find((button) => textOf(button) === label);

const tickTag = (tag: HTMLElement | undefined): void => {
  if (tag && !tag.classList.contains(ACTIVE_TAG)) tag.click();
};

async function findColor(body: Element, colors: Element | undefined, label: string, wait: FrameWait): Promise<HTMLElement | undefined> {
  const shown = tagIn(colors, label);
  if (shown) return shown;
  const expand = [...body.querySelectorAll<HTMLElement>('button')].find((button) => textOf(button) === EXPAND_LABEL);
  expand?.click();
  const found = await wait(() => tagIn(colors, label));
  return found ?? undefined;
}

function tickSwitch(body: Element, mark: string): void {
  const control = [...body.querySelectorAll(SWITCH)].find((candidate) => textOf(candidate).includes(mark));
  const input = control?.querySelector('input');
  if (input && !input.checked) input.click();
}

async function applyDropdown(body: Element, wanted: WantedFilters, wait: FrameWait): Promise<void> {
  const [ranks, colors] = body.querySelectorAll(TAGS);
  for (const rank of wanted.ranks) tickTag(tagIn(ranks, rank));
  for (const color of wanted.colors) tickTag(await findColor(body, colors, color, wait));
  if (wanted.isAnimated) tickSwitch(body, ANIMATED_MARK);
  if (wanted.isExplicit) tickSwitch(body, EXPLICIT_MARK);
}

export async function applyFilters(pageDocument: Document, toolbar: Element, wanted: WantedFilters, wait: FrameWait): Promise<boolean> {
  const trigger = filterTriggerOf(toolbar);
  if (!trigger) return false;
  trigger.click();
  const body = await wait(() => pageDocument.querySelector(FILTER_BODY));
  if (!body) return false;
  await applyDropdown(body, wanted, wait);
  body.closest('.v-popper__popper')?.querySelector<HTMLElement>(CLOSE_BUTTON)?.click();
  return true;
}
