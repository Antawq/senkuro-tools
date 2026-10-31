import { CARD_ROW_CLASS } from './cards';

const PAGING_ROOT_MARGIN = '0px 0px 250px 0px';
const PARKED_ATTRIBUTE = 'data-senkutools-paging-parked';

interface PagingState {
  sentinel: Element;
  rowCount: number;
  firstRow: Element | null;
  lastRow: Element | null;
}

const parkedStates = new WeakMap<Element, PagingState>();
const watchedSentinels = new WeakSet<Element>();

const findSentinel = (results: Element): HTMLElement | undefined =>
  [...results.children].find((child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains(CARD_ROW_CLASS));

function pagingStateOf(results: Element, sentinel: Element): PagingState {
  const rows = results.querySelectorAll(`:scope > .${CARD_ROW_CLASS}`);
  return { sentinel, rowCount: rows.length, firstRow: rows[0] ?? null, lastRow: rows[rows.length - 1] ?? null };
}

const isSameState = (known: PagingState | undefined, current: PagingState): boolean =>
  known?.sentinel === current.sentinel && known.rowCount === current.rowCount && known.firstRow === current.firstRow && known.lastRow === current.lastRow;

export function retriggerPaging(results: Element): void {
  const sentinel = findSentinel(results);
  if (!sentinel || watchedSentinels.has(sentinel)) return;
  const pagingState = pagingStateOf(results, sentinel);
  if (isSameState(parkedStates.get(results), pagingState)) return;
  parkedStates.set(results, pagingState);
  watchedSentinels.add(sentinel);
  const observer = new IntersectionObserver(
    (entries) => {
      if (!sentinel.hasAttribute(PARKED_ATTRIBUTE) && entries.at(-1)?.isIntersecting) return sentinel.setAttribute(PARKED_ATTRIBUTE, '');
      sentinel.removeAttribute(PARKED_ATTRIBUTE);
      observer.disconnect();
      watchedSentinels.delete(sentinel);
      retriggerPaging(results);
    },
    { rootMargin: PAGING_ROOT_MARGIN }
  );
  observer.observe(sentinel);
}
