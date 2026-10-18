import { slugFromHref } from './cards';
import { debugLogger } from './debug';
import { REPLAY_EVENT, type Trade, type TradeStore } from './trade-capture';
import { matchOffer, matchTrade, matchTradeByCounts, shows } from './trade-match';
import type { CardRef, Side } from './trade-value';

const MODAL = '.modal-content--trade';
const CARD_LIST = '.modal-content--review';
const HISTORY = '.card-trade';
const OFFER = '.offer-card';
const NOTIFICATION = '.card-notif__info';

export const TRADE_PLACES = [MODAL, CARD_LIST, HISTORY, OFFER, NOTIFICATION].join(', ');

const INCOMING_SUBTITLE = 'Прими решение обмена';
const NOTIFICATION_COUNTS = /Получишь\s+(\d+)\D+?Отдашь\s+(\d+)/;
const LIST_OWNER = /\sу\s(.+)$/;
const ROLE_LABELS = { give: 'Отдаёшь', get: 'Получаешь' } as const;
const OFFER_CAPTIONS = { authored: 'Если примут', received: 'Если примешь' } as const;
const TRADE_SIDES = 2;

export type Role = keyof typeof ROLE_LABELS;

export interface Column extends Side {
  role: Role | null;
  label: string;
}

export type Placement = 'start' | 'end';

export type Variant = 'offer';

export interface Place {
  host: Element;
  placement: Placement;
  variant?: Variant;
  caption?: string;
  sentAt?: string | null;
  columns: Column[] | null;
}

type Reading = Pick<Place, 'columns' | 'sentAt'>;

interface Selection {
  give: Side;
  get: Side;
}

const selections = new WeakMap<Element, Selection>();
const fullLists = new Map<string, CardRef[]>();
let replayAsked = false;

const askReplayOnce = (store: TradeStore) => {
  if (replayAsked || store.trades().length > 0) return;
  replayAsked = true;
  document.dispatchEvent(new CustomEvent(REPLAY_EVENT));
};

const readCard = (preview: Element): CardRef => ({
  slug: slugFromHref(preview.querySelector('a.card-collect')?.getAttribute('href')),
  quantity: Number.parseInt(preview.querySelector('.card-collect-preview__status')?.textContent ?? '', 10) || 1,
  shard: preview.classList.contains('card-collect-preview--shard'),
});

const readCards = (root: Element | null | undefined): CardRef[] => (root ? [...root.querySelectorAll('.card-collect-preview')].map(readCard) : []);

const numberIn = (el: Element | null | undefined): number => Number(/\d+/.exec(el?.textContent ?? '')?.[0] ?? 0);

const nameOf = (root: Element | null | undefined): string => root?.querySelector('.card-name span')?.textContent?.trim() ?? '';

const whole = (cards: CardRef[]): Side => ({ cards, hidden: 0 });

const column = (role: Role, side: Side): Column => ({ role, label: ROLE_LABELS[role], ...side });

const readPanel = (panel: Element): Side => {
  const cards = readCards(panel.querySelector('.modal-trade__swap-cards'));
  return { cards, hidden: Math.max(0, (numberIn(panel.querySelector('.card-info')) || cards.length) - cards.length) };
};

function viewerColumns(trade: Trade, viewerId: string | null, [sourceName = '', destinationName = '']: string[]): Column[] {
  if (viewerId && viewerId === trade.source.id) return [column('give', whole(trade.offer)), column('get', whole(trade.request))];
  if (viewerId && viewerId === trade.destination.id) return [column('get', whole(trade.offer)), column('give', whole(trade.request))];
  return [
    { role: null, label: sourceName, ...whole(trade.offer) },
    { role: null, label: destinationName, ...whole(trade.request) },
  ];
}

function readConstructor(modal: Element): Column[] | null {
  const preview = modal.querySelector('.modal-trade__preview');
  if (!preview?.querySelector('.modal-trade__preview-icon')) return null;
  const [requests, offers] = preview.querySelectorAll('.modal-trade__preview-list');
  if (!requests || !offers) return null;
  const selection = { give: whole(readCards(offers)), get: whole(readCards(requests)) };
  selections.set(modal, selection);
  return [column('get', selection.get), column('give', selection.give)];
}

function rememberCardLists(): void {
  for (const list of document.querySelectorAll(CARD_LIST)) {
    const owner = LIST_OWNER.exec(list.querySelector('.modal-trade__review-text')?.textContent?.trim() ?? '')?.[1];
    if (owner) fullLists.set(owner, readCards(list.querySelector('.modal-trade__review-slider')));
  }
}

const fromList = (name: string | undefined, side: Side): Side => {
  const list = name === undefined ? undefined : fullLists.get(name);
  return list && shows(list, side) ? whole(list) : side;
};

interface Review {
  incoming: boolean;
  known: Selection | undefined;
  store: TradeStore;
}

const reviewOf = (modal: Element, store: TradeStore): Review => {
  const incoming = modal.querySelector('header')?.textContent?.includes(INCOMING_SUBTITLE) ?? false;
  return { incoming, known: incoming ? undefined : selections.get(modal), store };
};

const rolesOf = (incoming: boolean): [Role, Role] => (incoming ? ['get', 'give'] : ['give', 'get']);

function readExchange(panels: Element[], { incoming, known, store }: Review): Reading {
  const [left, right] = panels.map(readPanel);
  if (!left || !right) return { columns: null };
  if (known && shows(known.give.cards, left) && shows(known.get.cards, right)) return { columns: [column('give', known.give), column('get', known.get)] };
  const [sourceName = '', destinationName = ''] = panels.map(nameOf);
  if (incoming) {
    const trade = matchTrade(store.trades(), [sourceName, destinationName], [left, right]);
    if (trade) return { columns: [column('get', whole(trade.offer)), column('give', whole(trade.request))], sentAt: trade.createdAt };
    askReplayOnce(store);
  }
  const [first, second] = rolesOf(incoming);
  return { columns: [column(first, fromList(sourceName, left)), column(second, fromList(destinationName, right))] };
}

function readGift(gift: Element, { incoming, known, store }: Review): Reading {
  const side = readPanel(gift);
  if (known && shows(known.give.cards, side)) return { columns: [column('give', known.give)] };
  if (incoming) {
    const trade = matchTrade(store.trades(), [nameOf(gift), null], [side, whole([])]);
    if (trade) return { columns: [column('get', whole(trade.offer))], sentAt: trade.createdAt };
  }
  return { columns: [column(rolesOf(incoming)[0], fromList(nameOf(gift), side))] };
}

function readReview(modal: Element, store: TradeStore): Reading {
  const review = reviewOf(modal, store);
  const panels = [...modal.querySelectorAll('.modal-trade__swap-el')];
  if (panels.length >= TRADE_SIDES) return readExchange(panels, review);
  const gift = modal.querySelector('.modal-trade__swap-gift__icon')?.closest('.modal-trade__swap-el');
  return gift ? readGift(gift, review) : { columns: null };
}

const readModal = (modal: Element, store: TradeStore): Reading => {
  const composed = readConstructor(modal);
  return composed ? { columns: composed } : readReview(modal, store);
};

const readModals = (store: TradeStore): Place[] =>
  [...document.querySelectorAll(MODAL)].flatMap((modal) => {
    const host = modal.querySelector('.modal-trade__footer');
    return host ? [{ host, placement: 'start' as const, ...readModal(modal, store) }] : [];
  });

const readPreviewList = (list: Element): Side => ({
  cards: readCards(list.querySelector('.card-preview-list__slider')),
  hidden: numberIn(list.querySelector('.card-preview-list-show-more')),
});

const readHistory = (store: TradeStore): Place[] =>
  [...document.querySelectorAll(HISTORY)].map((host) => {
    const lists = [...host.children].filter((el) => el.matches('.card-preview-list'));
    const names = lists.map(nameOf);
    const [offerList, requestList] = lists;
    const trade =
      lists.length === TRADE_SIDES && offerList && requestList
        ? matchTrade(store.trades(), [names[0] ?? '', names[1] ?? ''], [readPreviewList(offerList), readPreviewList(requestList)])
        : null;
    if (!trade) return { host, placement: 'end', columns: null };
    return { host, placement: 'end', columns: viewerColumns(trade, store.viewerId(), names), sentAt: trade.createdAt };
  });

const surfaceOf = (card: Element): Element => {
  const top = card.querySelector('.offer-card__top');
  let surface = card;
  for (let el = card.querySelector('.offer-card__cnt-list')?.parentElement; el && el !== card && !el.contains(top); el = el.parentElement) surface = el;
  return surface;
};

const unmatched = new Set<string>();

const readOffers = (store: TradeStore): Place[] => {
  const debug = debugLogger();
  return [...document.querySelectorAll(OFFER)].map((card) => {
    const host = surfaceOf(card);
    const top = { cards: readCards(card.querySelector('.offer-card__top-list')), hidden: numberIn(card.querySelector('.offer-card__top-more')) };
    const middle = { cards: readCards(card.querySelector('.offer-card__cnt-list')), hidden: numberIn(card.querySelector('.offer-card__cnt-el-more')) };
    const author = card.querySelector('.offer-card__top h3 span')?.textContent?.trim() ?? '';
    const offer = matchOffer(store.offers(), author, top, middle);
    if (!offer) {
      const key = `${author}|${store.offers().length}`;
      if (!unmatched.has(key)) {
        unmatched.add(key);
        const first = (side: Side) => ({ shown: side.cards.map(({ slug, quantity }) => `${slug}x${quantity}`), hidden: side.hidden });
        const stored = store.offers().filter((candidate) => candidate.author.name === author);
        debug('offer not matched', {
          author,
          top: first(top),
          middle: first(middle),
          captured: store.offers().length,
          sameAuthor: stored.map((candidate) => ({
            offer: candidate.offer.length,
            request: candidate.request.length,
            first: [candidate.offer[0]?.slug, candidate.request[0]?.slug],
          })),
        });
      }
      return { host, placement: 'end', variant: 'offer', columns: null };
    }
    const [give, get] = offer.viewerDidAuthor ? [offer.offer, offer.request] : [offer.request, offer.offer];
    return {
      host,
      placement: 'end',
      variant: 'offer',
      caption: offer.viewerDidAuthor ? OFFER_CAPTIONS.authored : OFFER_CAPTIONS.received,
      columns: [column('give', whole(give)), column('get', whole(get))],
    };
  });
};

const readNotifications = (store: TradeStore): Place[] =>
  [...document.querySelectorAll(NOTIFICATION)].flatMap((host) => {
    const counts = [...host.querySelectorAll('.card-notif__info-hint')].map((el) => NOTIFICATION_COUNTS.exec(el.textContent ?? '')).find(Boolean);
    if (!counts) return [];
    const sender = host.closest('.card-notif')?.querySelector('.card-notif__source-title')?.textContent?.trim() ?? '';
    const trade = matchTradeByCounts(store.trades(), sender, Number(counts[1]), Number(counts[2]));
    return [{ host, placement: 'end' as const, columns: trade ? [column('get', whole(trade.offer)), column('give', whole(trade.request))] : null }];
  });

export function readTradePlaces(store: TradeStore): Place[] {
  rememberCardLists();
  return [...readModals(store), ...readHistory(store), ...readOffers(store), ...readNotifications(store)];
}
