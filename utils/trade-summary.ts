import type { Database } from './database';
import type { TradeStore } from './trade-capture';
import { MODAL, readTradePlaces, type Column, type Placement, type Role } from './trade-dom';
import { totalOf } from './trade-match';
import { compareShards, compareSides, formatAmount, formatByRank, valueSide, type SideValue, type Verdict } from './trade-value';

const SUMMARY = 'senkuro-trade-summary';
const CLOSED = `${SUMMARY}--closed`;
const STAGGER_LIMIT = 6;
const UNKNOWN = `${SUMMARY}__unknown`;

type RowKey = 'value' | 'bank' | 'count' | 'shards';

const ROWS: [RowKey, string][] = [
  ['value', 'ценность'],
  ['bank', 'банк'],
  ['count', 'карты'],
  ['shards', 'осколки'],
];

export interface SummarySettings {
  commission: boolean;
}

interface SideView {
  role: Role | null;
  label: string;
  value: SideValue;
  f: string;
  bank: string[];
  count: string[];
  unknown: string;
  shards: string[] | null;
  shardUnknown: string;
  shardF: string;
}

const describe = (column: Column, db: Database, { commission }: SummarySettings): SideView => {
  const value = valueSide(column, db, commission);
  return {
    role: column.role,
    label: column.label,
    value,
    f: `${formatAmount(value.f)}F`,
    bank: formatByRank(value.bank),
    count: formatByRank(value.count),
    unknown: value.unknown ? `${value.unknown}X` : '',
    shards: value.hasShards ? formatByRank(value.shards) : null,
    shardUnknown: value.shardUnknown ? `${value.shardUnknown}X` : '',
    shardF: value.hasShards ? `${formatAmount(value.shardF)}F` : '',
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
  if (!side.shards) return amounts(cell, [], '');
  amounts(cell, side.shards, side.shardUnknown);
  cell.append(' · ', element('span', side.value.shardsComplete ? '' : UNKNOWN, side.shardF));
  return cell;
}

function table(sides: SideView[]): HTMLElement {
  const grid = element('div', `${SUMMARY}__table`);
  grid.style.setProperty('--senkuro-columns', String(sides.length));
  grid.append(element('span'), ...sides.map((side) => element('span', `${SUMMARY}__side`, side.label)));
  for (const [key, label] of ROWS) {
    if (key === 'shards' && !sides.some((side) => side.shards)) continue;
    grid.append(element('span', `${SUMMARY}__label`, label), ...sides.map((side) => cellOf(side, key)));
  }
  return grid;
}

function mount(host: Element, placement: Placement, order: number): HTMLElement {
  const summary = element('div', `${SUMMARY} ${SUMMARY}--${placement}`);
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

function render(host: Element, placement: Placement, caption: string | undefined, sides: SideView[], nextOrder: () => number): void {
  const give = sides.find((side) => side.role === 'give')?.value;
  const get = sides.find((side) => side.role === 'get')?.value;
  const verdict = give && get ? compareSides(give, get) : null;
  const shardVerdict = give && get ? compareShards(give, get) : null;
  const signature = JSON.stringify([
    caption,
    sides.map(({ label, f, bank, count, unknown, shards, shardUnknown, shardF }) => [label, f, bank, count, unknown, shards, shardUnknown, shardF]),
    verdict,
    shardVerdict,
  ]);

  const summary = host.querySelector<HTMLElement>(`:scope > .${SUMMARY}`) ?? mount(host, placement, nextOrder());
  summary.classList.remove(CLOSED);
  if (summary.dataset.signature === signature) return;
  summary.dataset.signature = signature;

  const parts: HTMLElement[] = caption ? [element('div', `${SUMMARY}__label`, caption)] : [];
  parts.push(table(sides));
  const verdicts: [Verdict | null, string][] = [
    [verdict, ''],
    [shardVerdict, ` ${SUMMARY}__verdict--shards`],
  ];
  for (const [result, extra] of verdicts) {
    if (!result) continue;
    const state = result.complete ? `${SUMMARY}__verdict--${result.kind}` : UNKNOWN;
    parts.push(element('div', `${SUMMARY}__verdict ${state}${extra}`, result.text));
  }
  summary.querySelector(`.${SUMMARY}__content`)?.replaceChildren(...parts);
}

export function updateTradeSummaries(db: Database, settings: SummarySettings, store: TradeStore): void {
  let mounted = 0;
  const nextOrder = () => mounted++;
  for (const { host, placement, caption, columns } of readTradePlaces(store)) {
    if (!columns || columns.every((column) => totalOf(column) === 0)) {
      host.querySelector(`:scope > .${SUMMARY}`)?.classList.add(CLOSED);
      continue;
    }
    render(
      host,
      placement,
      caption,
      columns.map((column) => describe(column, db, settings)),
      nextOrder
    );
  }
}

export const isTradeMutation = (mutation: MutationRecord): boolean => {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  return Boolean(target?.closest(MODAL)) && !target?.closest(`.${SUMMARY}`);
};
