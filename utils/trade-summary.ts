import type { Database } from './database';
import type { TradeStore } from './trade-capture';
import { MODAL, readTradePlaces, type Column, type Placement, type Role, type Variant } from './trade-dom';
import type { ValueBasis } from './settings';
import { totalOf } from './trade-match';
import {
  CRAFT_PER_RANK,
  SPLIT_PER_RANK,
  compareR,
  compareSides,
  formatAmount,
  formatByRank,
  formatShardsByRank,
  hasR,
  valueSide,
  type SideValue,
  type Verdict,
} from './trade-value';

const SUMMARY = 'senkuro-trade-summary';
const CLOSED = `${SUMMARY}--closed`;
const COLLAPSIBLE = `${SUMMARY}--collapsible`;
const EXPANDED = `${SUMMARY}--expanded`;
const STAGGER_LIMIT = 6;
const UNKNOWN = `${SUMMARY}__unknown`;
const EXPAND_LABEL = 'Раскрыть полностью';
const COLLAPSE_LABEL = 'Скрыть';

type RowKey = 'value' | 'bank' | 'count';

const ROWS: [RowKey, string][] = [
  ['value', 'Ценность'],
  ['bank', 'Банк'],
  ['count', 'Карты'],
];

const R_ROWS: [RowKey, string][] = [
  ['value', 'Ценность'],
  ['count', 'Карты'],
];

export interface SummarySettings {
  commission: boolean;
  valueBySplit: boolean;
  valueBasis: ValueBasis;
  showSummaryF: boolean;
  showSummaryBank: boolean;
  showSummaryCards: boolean;
  showSummaryVerdict: boolean;
}

interface RView {
  value: string;
  cards: string[];
  complete: boolean;
}

interface SideView {
  role: Role | null;
  label: string;
  value: SideValue;
  f: string;
  bank: string[];
  count: string[];
  unknown: string;
  r: RView | null;
}

const describeR = ({ r }: SideValue): RView => ({
  value: `${formatAmount(r.value)}R`,
  cards: [...(r.count > 0 ? [`${formatAmount(r.count)}R`] : []), ...(r.shards > 0 ? [`${formatAmount(r.shards)}oR`] : [])],
  complete: r.complete,
});

const describe = (column: Column, db: Database, { commission, valueBySplit, valueBasis }: SummarySettings): SideView => {
  const value = valueSide(column, db, commission, valueBySplit ? SPLIT_PER_RANK : CRAFT_PER_RANK, valueBasis);

  const countArray = formatByRank(value.count);
  const shardsArray = formatShardsByRank(value.shards);

  let unknownStr = '';
  if (value.unknown > 0) unknownStr += `${value.unknown}X`;
  if (value.shardUnknown > 0) unknownStr += (unknownStr ? ' ' : '') + `${value.shardUnknown}oX`;

  return {
    role: column.role,
    label: column.label,
    value,
    f: `${formatAmount(value.f)}F`,
    bank: formatByRank(value.bank),
    count: [...countArray, ...shardsArray],
    unknown: unknownStr,
    r: hasR(value) ? describeR(value) : null,
  };
};

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const amounts = (cell: HTMLElement, parts: string[], unknown: string): HTMLElement => {
  const known = parts.join(' ');
  if (known) cell.append(known);
  if (unknown) cell.append(known ? ' ' : '', element('span', UNKNOWN, unknown));
  if (!known && !unknown) cell.append('-');
  return cell;
};

function cellOf(side: SideView, key: RowKey): HTMLElement {
  const cell = element('span', `${SUMMARY}__cell`);
  if (key === 'value') {
    cell.append(element('strong', side.value.complete ? '' : UNKNOWN, side.f));
    return cell;
  }
  if (key === 'bank') return amounts(cell, side.bank, side.unknown);
  if (key === 'count') return amounts(cell, side.count, side.unknown);
  return cell;
}

function rCell(side: SideView, key: RowKey): HTMLElement {
  const cell = element('span', `${SUMMARY}__cell`);
  if (!side.r) return amounts(cell, [], '');
  if (key === 'value') cell.append(element('strong', side.r.complete ? '' : UNKNOWN, side.r.value));
  else amounts(cell, side.r.cards, '');
  return cell;
}

function rWindow(sides: SideView[]): HTMLElement | null {
  if (!sides.some((side) => side.r)) return null;
  const grid = element('div', `${SUMMARY}__table`);
  grid.style.setProperty('--senkuro-columns', String(sides.length));
  for (const [key, label] of R_ROWS) grid.append(element('span', `${SUMMARY}__label`, label), ...sides.map((side) => rCell(side, key)));
  const window = element('div', `${SUMMARY}__window`);
  window.append(element('div', `${SUMMARY}__window-title`, 'R'), grid);
  return window;
}

function panel(sides: SideView[], settings: SummarySettings): HTMLElement {
  const wrapper = element('div', `${SUMMARY}__panel`);
  wrapper.append(table(sides, settings));
  const window = rWindow(sides);
  if (window) wrapper.append(window);
  return wrapper;
}

function table(sides: SideView[], settings: SummarySettings): HTMLElement {
  const grid = element('div', `${SUMMARY}__table`);
  grid.style.setProperty('--senkuro-columns', String(sides.length));
  grid.append(element('span'), ...sides.map((side) => element('span', `${SUMMARY}__side`, side.label)));
  for (const [key, label] of ROWS) {
    if (key === 'value' && !settings.showSummaryF) continue;
    if (key === 'bank' && !settings.showSummaryBank) continue;
    if (key === 'count' && !settings.showSummaryCards) continue;
    grid.append(element('span', `${SUMMARY}__label`, label), ...sides.map((side) => cellOf(side, key)));
  }
  return grid;
}

function expandToggle(summary: HTMLElement): HTMLButtonElement {
  const button = element('button', `${SUMMARY}__toggle`);
  button.type = 'button';
  const sync = () => {
    const expanded = summary.classList.contains(EXPANDED);
    button.textContent = expanded ? COLLAPSE_LABEL : EXPAND_LABEL;
    button.setAttribute('aria-expanded', String(expanded));
  };
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    summary.classList.toggle(EXPANDED);
    sync();
  });
  sync();
  return button;
}

function mount(host: Element, placement: Placement, variant: Variant | undefined, order: number): HTMLElement {
  const summary = element('div', `${SUMMARY} ${SUMMARY}--${placement}${variant ? ` ${SUMMARY}--${variant}` : ''}`);
  const gap = getComputedStyle(host).rowGap;
  summary.style.setProperty('--senkuro-host-gap', gap.endsWith('px') ? gap : '0px');
  summary.style.setProperty('--senkuro-order', String(Math.min(order, STAGGER_LIMIT)));
  const body = element('div', `${SUMMARY}__body`);
  body.append(element('div', `${SUMMARY}__content`));
  summary.append(body);
  if (placement === 'start') host.prepend(summary);
  else host.append(summary);
  return summary;
}

function render(
  host: Element,
  placement: Placement,
  variant: Variant | undefined,
  caption: string | undefined,
  sides: SideView[],
  settings: SummarySettings,
  nextOrder: () => number
): void {
  const give = sides.find((side) => side.role === 'give')?.value;
  const get = sides.find((side) => side.role === 'get')?.value;
  const verdict = settings.showSummaryVerdict && give && get ? compareSides(give, get) : null;
  const rVerdict = settings.showSummaryVerdict && give && get ? compareR(give, get) : null;
  const signature = JSON.stringify([
    caption,
    sides.map(({ label, f, bank, count, unknown, r }) => [label, f, bank, count, unknown, r]),
    verdict,
    rVerdict,
    settings.showSummaryF,
    settings.showSummaryBank,
    settings.showSummaryCards,
  ]);

  const summary = host.querySelector<HTMLElement>(`:scope > .${SUMMARY}`) ?? mount(host, placement, variant, nextOrder());
  summary.classList.remove(CLOSED);
  if (summary.dataset.signature === signature) return;
  summary.dataset.signature = signature;
  summary.classList.toggle(COLLAPSIBLE, Boolean(verdict));

  const parts: HTMLElement[] = caption ? [element('div', `${SUMMARY}__label`, caption)] : [];
  const details = element('div', `${SUMMARY}__details`);
  details.append(panel(sides, settings));
  parts.push(details);
  if (verdict) {
    const state = verdict.complete ? `${SUMMARY}__verdict--${verdict.kind}` : UNKNOWN;
    parts.push(element('div', `${SUMMARY}__verdict ${state}`, verdict.text));
    if (rVerdict) {
      const rState = rVerdict.complete ? `${SUMMARY}__verdict--${rVerdict.kind}` : UNKNOWN;
      parts.push(element('div', `${SUMMARY}__verdict ${rState} ${SUMMARY}__verdict--r`, rVerdict.text));
    }
    parts.push(expandToggle(summary));
  }
  summary.querySelector(`.${SUMMARY}__content`)?.replaceChildren(...parts);
}

export function updateTradeSummaries(db: Database, settings: SummarySettings, store: TradeStore): void {
  let mounted = 0;
  const nextOrder = () => mounted++;
  for (const { host, placement, variant, caption, columns } of readTradePlaces(store)) {
    if (!columns || columns.every((column) => totalOf(column) === 0)) {
      host.querySelector(`:scope > .${SUMMARY}`)?.classList.add(CLOSED);
      continue;
    }
    render(
      host,
      placement,
      variant,
      caption,
      columns.map((column) => describe(column, db, settings)),
      settings,
      nextOrder
    );
  }
}

export const isTradeMutation = (mutation: MutationRecord): boolean => {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  return Boolean(target?.closest(MODAL)) && !target?.closest(`.${SUMMARY}`);
};
