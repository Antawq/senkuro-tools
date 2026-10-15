import type { Database } from './database';
import { element } from './dom';
import type { TradeStore } from './trade-capture';
import { TRADE_PLACES, readTradePlaces, type Column, type Placement, type Role, type Variant } from './trade-dom';
import { totalOf } from './trade-match';
import {
  F_UNIT,
  R_RANK,
  SHARD_MARK,
  UNKNOWN_MARK,
  compareR,
  compareSides,
  formatAmount,
  formatByRank,
  formatShardsByRank,
  hasR,
  valueSide,
  type SideValue,
  type Valuation,
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
const EMPTY_CELL = '-';
const UNKNOWN_LEGEND = `${UNKNOWN_MARK} - нет цены в базе`;

type RowKey = 'value' | 'bank' | 'count';

const ROW_LABELS: Record<RowKey, string> = { value: 'Ценность', bank: 'Банк', count: 'Карты' };

const ROWS: RowKey[] = ['value', 'bank', 'count'];

const R_ROWS: RowKey[] = ['value', 'count'];

export interface SummarySettings extends Valuation {
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
  value: `${formatAmount(r.value)}${R_RANK}`,
  cards: [...(r.count > 0 ? [`${formatAmount(r.count)}${R_RANK}`] : []), ...(r.shards > 0 ? [`${formatAmount(r.shards)}${SHARD_MARK}${R_RANK}`] : [])],
  complete: r.complete,
});

const describe = (column: Column, db: Database, settings: SummarySettings): SideView => {
  const value = valueSide(column, db, settings);

  const countArray = formatByRank(value.count);
  const shardsArray = formatShardsByRank(value.shards);

  let unknownStr = '';
  if (value.unknown > 0) unknownStr += `${value.unknown}${UNKNOWN_MARK}`;
  if (value.shardUnknown > 0) unknownStr += (unknownStr ? ' ' : '') + `${value.shardUnknown}${SHARD_MARK}${UNKNOWN_MARK}`;

  return {
    role: column.role,
    label: column.label,
    value,
    f: `${formatAmount(value.f)}${F_UNIT}`,
    bank: [...formatByRank(value.bank), ...formatShardsByRank(value.shardBank)],
    count: [...countArray, ...shardsArray],
    unknown: unknownStr,
    r: hasR(value) ? describeR(value) : null,
  };
};

const amounts = (cell: HTMLElement, parts: string[], unknown: string): HTMLElement => {
  const known = parts.join(' ');
  if (known) cell.append(known);
  if (unknown) cell.append(known ? ' ' : '', element('span', UNKNOWN, unknown));
  if (!known && !unknown) cell.append(EMPTY_CELL);
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
  for (const key of R_ROWS) grid.append(element('span', `${SUMMARY}__label`, ROW_LABELS[key]), ...sides.map((side) => rCell(side, key)));
  const window = element('div', `${SUMMARY}__window`);
  window.append(element('div', `${SUMMARY}__window-title`, R_RANK), grid);
  return window;
}

function panel(sides: SideView[], settings: SummarySettings): HTMLElement {
  const wrapper = element('div', `${SUMMARY}__panel`);
  wrapper.append(table(sides, settings));
  const window = rWindow(sides);
  if (window) wrapper.append(window);
  const showsUnknown = settings.showSummaryBank || settings.showSummaryCards;
  if (showsUnknown && sides.some((side) => side.unknown)) wrapper.append(element('div', UNKNOWN, UNKNOWN_LEGEND));
  return wrapper;
}

function table(sides: SideView[], settings: SummarySettings): HTMLElement {
  const grid = element('div', `${SUMMARY}__table`);
  grid.style.setProperty('--senkuro-columns', String(sides.length));
  grid.append(element('span'), ...sides.map((side) => element('span', `${SUMMARY}__side`, side.label)));
  for (const key of ROWS) {
    if (key === 'value' && !settings.showSummaryF) continue;
    if (key === 'bank' && !settings.showSummaryBank) continue;
    if (key === 'count' && !settings.showSummaryCards) continue;
    grid.append(element('span', `${SUMMARY}__label`, ROW_LABELS[key]), ...sides.map((side) => cellOf(side, key)));
  }
  return grid;
}

const verdictState = ({ kind, certain }: Verdict): string => (certain ? `${SUMMARY}__verdict--${kind}` : UNKNOWN);

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
    parts.push(element('div', `${SUMMARY}__verdict ${verdictState(verdict)}`, verdict.text));
    if (rVerdict) parts.push(element('div', `${SUMMARY}__verdict ${verdictState(rVerdict)} ${SUMMARY}__verdict--r`, rVerdict.text));
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

const isSummary = (node: Node): boolean => node instanceof Element && node.classList.contains(SUMMARY);

const holdsPlace = (node: Node): boolean => node instanceof Element && (node.matches(TRADE_PLACES) || node.querySelector(TRADE_PLACES) !== null);

export const isTradeMutation = (mutation: MutationRecord): boolean => {
  const changed = [...mutation.addedNodes, ...mutation.removedNodes];
  if (changed.length > 0 && changed.every(isSummary)) return false;
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (target?.closest(`.${SUMMARY}`)) return false;
  return Boolean(target?.closest(TRADE_PLACES)) || [...mutation.addedNodes].some(holdsPlace);
};
