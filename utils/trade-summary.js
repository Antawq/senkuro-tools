import { MODAL, readTradePlaces } from './trade-dom.js';
import { totalOf } from './trade-match.js';
import { compareShards, compareSides, formatAmount, formatByRank, valueSide } from './trade-value.js';

const SUMMARY = 'senkuro-trade-summary';
const CLOSED = `${SUMMARY}--closed`;
const STAGGER_LIMIT = 6;
const UNKNOWN = `${SUMMARY}__unknown`;
const ROWS = [
  ['value', 'ценность'],
  ['bank', 'банк'],
  ['count', 'карты'],
  ['shards', 'осколки'],
];

const describe = (column, db, { commission }) => {
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

const element = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const amounts = (cell, parts, unknown) => {
  const known = parts.join(' ');
  if (known) cell.append(known);
  if (unknown) cell.append(known ? ' ' : '', element('span', UNKNOWN, unknown));
  if (!known && !unknown) cell.append('-');
  return cell;
};

function cellOf(side, key) {
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

function table(sides) {
  const grid = element('div', `${SUMMARY}__table`);
  grid.style.setProperty('--senkuro-columns', String(sides.length));
  grid.append(element('span'), ...sides.map((side) => element('span', `${SUMMARY}__side`, side.label)));
  for (const [key, label] of ROWS) {
    if (key === 'shards' && !sides.some((side) => side.shards)) continue;
    grid.append(element('span', `${SUMMARY}__label`, label), ...sides.map((side) => cellOf(side, key)));
  }
  return grid;
}

function mount(host, placement, order) {
  const summary = element('div', `${SUMMARY} ${SUMMARY}--${placement}`);
  const gap = getComputedStyle(host).rowGap;
  summary.style.setProperty('--senkuro-host-gap', gap?.endsWith('px') ? gap : '0px');
  summary.style.setProperty('--senkuro-order', String(Math.min(order, STAGGER_LIMIT)));
  const body = element('div', `${SUMMARY}__body`);
  body.append(element('div', `${SUMMARY}__content`));
  summary.append(body);
  if (placement === 'start') host.prepend(summary);
  else host.append(summary);
  return summary;
}

function render(host, placement, caption, sides, nextOrder) {
  const byRole = Object.fromEntries(sides.map((side) => [side.role, side.value]));
  const verdict = byRole.give && byRole.get ? compareSides(byRole.give, byRole.get) : null;
  const shardVerdict = byRole.give && byRole.get ? compareShards(byRole.give, byRole.get) : null;
  const signature = JSON.stringify([
    caption,
    sides.map(({ label, f, bank, count, unknown, shards, shardUnknown, shardF }) => [label, f, bank, count, unknown, shards, shardUnknown, shardF]),
    verdict,
    shardVerdict,
  ]);

  const summary = host.querySelector(`:scope > .${SUMMARY}`) ?? mount(host, placement, nextOrder());
  summary.classList.remove(CLOSED);
  if (summary.dataset.signature === signature) return;
  summary.dataset.signature = signature;

  const parts = caption ? [element('div', `${SUMMARY}__label`, caption)] : [];
  parts.push(table(sides));
  for (const [result, extra] of [
    [verdict, ''],
    [shardVerdict, ` ${SUMMARY}__verdict--shards`],
  ]) {
    if (!result) continue;
    const state = result.complete ? `${SUMMARY}__verdict--${result.kind}` : UNKNOWN;
    parts.push(element('div', `${SUMMARY}__verdict ${state}${extra}`, result.text));
  }
  summary.querySelector(`.${SUMMARY}__content`).replaceChildren(...parts);
}

export function updateTradeSummaries(db, settings, store) {
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

export const isTradeMutation = (mutation) => {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  return Boolean(target?.closest(MODAL)) && !target.closest(`.${SUMMARY}`);
};
