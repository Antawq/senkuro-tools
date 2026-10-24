import type { Database } from '../shared/database';
import { element } from '../shared/dom';
import { chevronIcon } from '../shared/svg';
import {
  F_UNIT,
  R_RANK,
  SHARD_MARK,
  UNKNOWN_LEGEND,
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
} from '../shared/trade-value';
import { MODAL_REFRESH_CLASS } from './modal-refresh';
import { createMutationFilter } from './mutation-watcher';
import type { TradeStore } from './trade-capture';
import { TRADE_PLACES, readTradePlaces, type Column, type Place, type Role } from './trade-dom';
import { totalOf } from './trade-match';

const SUMMARY = 'senkuro-trade-summary';
const CLOSED = `${SUMMARY}--closed`;
const COLLAPSIBLE = `${SUMMARY}--collapsible`;
const EXPANDED = `${SUMMARY}--expanded`;
const STAGGER_LIMIT = 6;
const UNKNOWN = `${SUMMARY}__unknown`;
const TOGGLE_LABEL = 'Подробности';
const EMPTY_CELL = '-';

type RowKey = 'value' | 'bank' | 'count';

const ROW_LABELS: Record<RowKey, string> = { value: 'Ценность', bank: 'Банк', count: 'Карты' };

const ROWS: RowKey[] = ['value', 'bank', 'count'];

const R_ROWS: RowKey[] = ['value', 'count'];

const ROW_SETTINGS = { value: 'showSummaryF', bank: 'showSummaryBank', count: 'showSummaryCards' } as const;

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

const rowsShown = (rows: RowKey[], settings: SummarySettings): RowKey[] => rows.filter((key) => settings[ROW_SETTINGS[key]]);

function rBlock(sides: SideView[], settings: SummarySettings): HTMLElement | null {
  const rows = rowsShown(R_ROWS, settings);
  if (rows.length === 0 || !sides.some((side) => side.r)) return null;
  const grid = element('div', `${SUMMARY}__table`);
  grid.style.setProperty('--senkuro-columns', String(sides.length));
  for (const key of rows) grid.append(element('span', `${SUMMARY}__label`, ROW_LABELS[key]), ...sides.map((side) => rCell(side, key)));
  const window = element('div', `${SUMMARY}__window`);
  window.append(element('div', `${SUMMARY}__window-title`, R_RANK), grid);
  return window;
}

function panel(sides: SideView[], settings: SummarySettings): HTMLElement | null {
  const showsUnknown = settings.showSummaryBank || settings.showSummaryCards;
  const parts = [
    table(sides, settings),
    rBlock(sides, settings),
    showsUnknown && sides.some((side) => side.unknown) ? element('div', UNKNOWN, UNKNOWN_LEGEND) : null,
  ].filter((part): part is HTMLElement => part !== null);
  if (parts.length === 0) return null;
  const wrapper = element('div', `${SUMMARY}__panel`);
  wrapper.append(...parts);
  return wrapper;
}

function table(sides: SideView[], settings: SummarySettings): HTMLElement | null {
  const rows = rowsShown(ROWS, settings);
  if (rows.length === 0) return null;
  const grid = element('div', `${SUMMARY}__table`);
  grid.style.setProperty('--senkuro-columns', String(sides.length));
  grid.append(element('span'), ...sides.map((side) => element('span', `${SUMMARY}__side`, side.label)));
  for (const key of rows) grid.append(element('span', `${SUMMARY}__label`, ROW_LABELS[key]), ...sides.map((side) => cellOf(side, key)));
  return grid;
}

const verdictState = ({ kind, certain }: Verdict): string => (certain ? `${SUMMARY}__verdict--${kind}` : UNKNOWN);

function expandToggle(summary: HTMLElement): HTMLButtonElement {
  const button = element('button', `${SUMMARY}__toggle`);
  button.type = 'button';
  button.setAttribute('aria-label', TOGGLE_LABEL);
  button.append(chevronIcon());
  const sync = () => button.setAttribute('aria-expanded', String(summary.classList.contains(EXPANDED)));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    summary.classList.toggle(EXPANDED);
    sync();
  });
  sync();
  return button;
}

function mount({ host, placement, variant }: Place, order: number): HTMLElement {
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

interface View {
  caption: string | undefined;
  sides: SideView[];
  settings: SummarySettings;
  verdict: Verdict | null;
  rVerdict: Verdict | null;
}

function viewOf(caption: string | undefined, columns: Column[], db: Database, settings: SummarySettings): View {
  const sides = columns.map((column) => describe(column, db, settings));
  const give = sides.find((side) => side.role === 'give')?.value;
  const get = sides.find((side) => side.role === 'get')?.value;
  if (!settings.showSummaryVerdict || !give || !get) return { caption, sides, settings, verdict: null, rVerdict: null };
  return { caption, sides, settings, verdict: compareSides(give, get), rVerdict: compareR(give, get) };
}

const signatureOf = ({ caption, sides, settings, verdict, rVerdict }: View): string =>
  JSON.stringify([
    caption,
    sides.map(({ label, f, bank, count, unknown, r, value }) => [label, f, bank, count, unknown, r, value.complete]),
    verdict,
    rVerdict,
    settings.showSummaryF,
    settings.showSummaryBank,
    settings.showSummaryCards,
  ]);

const verdictLine = (verdict: Verdict, ...extra: string[]): HTMLElement =>
  element('div', [`${SUMMARY}__verdict`, verdictState(verdict), ...extra].join(' '), verdict.text);

function detailsOf(body: HTMLElement): HTMLElement {
  const details = element('div', `${SUMMARY}__details`);
  details.append(body);
  return details;
}

function partsOf({ caption, verdict, rVerdict }: View, summary: HTMLElement, body: HTMLElement | null): HTMLElement[] {
  const lead = caption ? [element('div', `${SUMMARY}__label`, caption)] : [];
  const details = body ? [detailsOf(body)] : [];
  if (!verdict) return [...lead, ...details];
  const main = verdictLine(verdict);
  if (body) main.append(expandToggle(summary));
  return [...lead, main, ...details, ...(rVerdict ? [verdictLine(rVerdict, `${SUMMARY}__verdict--r`)] : [])];
}

function render(place: Place, view: View, nextOrder: () => number): void {
  const summary = place.host.querySelector<HTMLElement>(`:scope > .${SUMMARY}`) ?? mount(place, nextOrder());
  summary.classList.remove(CLOSED);
  const signature = signatureOf(view);
  if (summary.dataset.signature !== signature) {
    summary.dataset.signature = signature;
    const body = panel(view.sides, view.settings);
    const parts = partsOf(view, summary, body);
    summary.classList.toggle(COLLAPSIBLE, Boolean(view.verdict && body));
    summary.dataset.senkutoolsEmpty = String(parts.length === 0);
    summary.querySelector(`.${SUMMARY}__content`)?.replaceChildren(...parts);
  }
  if (summary.dataset.senkutoolsEmpty === 'true') summary.classList.add(CLOSED);
}

export function updateTradeSummaries(db: Database, settings: SummarySettings, store: TradeStore): void {
  let mounted = 0;
  const nextOrder = () => mounted++;
  for (const place of readTradePlaces(store)) {
    const { host, caption, columns } = place;
    if (!columns || columns.every((column) => totalOf(column) === 0)) {
      host.querySelector(`:scope > .${SUMMARY}`)?.classList.add(CLOSED);
      continue;
    }
    render(place, viewOf(caption, columns, db, settings), nextOrder);
  }
}

export const isTradeMutation = createMutationFilter(TRADE_PLACES, `.${SUMMARY}, .${MODAL_REFRESH_CLASS}`);
