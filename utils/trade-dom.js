import { slugFromHref } from './cards.js';
import { REPLAY_EVENT } from './trade-capture.js';
import { matchOffer, matchTrade, matchTradeByCounts, shows } from './trade-match.js';

export const MODAL = '.modal-content--trade';

const INCOMING_SUBTITLE = 'Прими решение обмена';
const NOTIFICATION_COUNTS = /Получишь\s+(\d+)\D+?Отдашь\s+(\d+)/;
const ROLE_LABELS = { give: 'Отдаёшь', get: 'Получаешь' };

const LIST_OWNER = /\sу\s(.+)$/;

const selections = new WeakMap();
const fullLists = new Map();
let replayAsked = false;

const askReplayOnce = (store) => {
  if (replayAsked || store.trades().length > 0) return;
  replayAsked = true;
  document.dispatchEvent(new CustomEvent(REPLAY_EVENT));
};

const readCard = (preview) => ({
  slug: slugFromHref(preview.querySelector('a.card-collect')?.getAttribute('href')),
  quantity: Number.parseInt(preview.querySelector('.card-collect-preview__status')?.textContent ?? '', 10) || 1,
  shard: preview.classList.contains('card-collect-preview--shard'),
});

const readCards = (root) => (root ? [...root.querySelectorAll('.card-collect-preview')].map(readCard) : []);

const numberIn = (el) => Number(/\d+/.exec(el?.textContent ?? '')?.[0] ?? 0);

const nameOf = (root) => root?.querySelector('.card-name span')?.textContent.trim() ?? '';

const whole = (cards) => ({ cards, hidden: 0 });

const column = (role, side) => ({ role, label: ROLE_LABELS[role], ...side });

const readPanel = (panel) => {
  const cards = readCards(panel.querySelector('.modal-trade__swap-cards'));
  return { cards, hidden: Math.max(0, (numberIn(panel.querySelector('.card-info')) || cards.length) - cards.length) };
};

function viewerColumns(trade, viewerId, names) {
  if (viewerId && viewerId === trade.source.id) return [column('give', whole(trade.offer)), column('get', whole(trade.request))];
  if (viewerId && viewerId === trade.destination.id) return [column('get', whole(trade.offer)), column('give', whole(trade.request))];
  return [
    { role: null, label: names[0], ...whole(trade.offer) },
    { role: null, label: names[1], ...whole(trade.request) },
  ];
}

function readConstructor(modal) {
  const preview = modal.querySelector('.modal-trade__preview');
  if (!preview?.querySelector('.modal-trade__preview-icon')) return null;
  const [requests, offers] = preview.querySelectorAll('.modal-trade__preview-list');
  if (!requests || !offers) return null;
  const selection = { give: whole(readCards(offers)), get: whole(readCards(requests)) };
  selections.set(modal, selection);
  return [column('get', selection.get), column('give', selection.give)];
}

function rememberCardLists() {
  for (const list of document.querySelectorAll('.modal-content--review')) {
    const owner = LIST_OWNER.exec(list.querySelector('.modal-trade__review-text')?.textContent.trim() ?? '')?.[1];
    if (owner) fullLists.set(owner, readCards(list.querySelector('.modal-trade__review-slider')));
  }
}

const fromList = (name, side) => {
  const list = fullLists.get(name);
  return list && shows(list, side) ? whole(list) : side;
};

function readReview(modal, store) {
  const incoming = modal.querySelector('header')?.textContent.includes(INCOMING_SUBTITLE) ?? false;
  const known = incoming ? undefined : selections.get(modal);

  const pair = modal.querySelector('.modal-trade__swap--col');
  if (pair) {
    const panels = [...pair.children].filter((el) => el.matches('.modal-trade__swap-el'));
    const [left, right] = panels.map(readPanel);
    if (!left || !right) return null;
    if (known && shows(known.give.cards, left) && shows(known.get.cards, right)) return [column('give', known.give), column('get', known.get)];
    const names = panels.map(nameOf);
    const trade = incoming ? matchTrade(store.trades(), names, [left, right]) : null;
    if (trade) return [column('get', whole(trade.offer)), column('give', whole(trade.request))];
    if (incoming) askReplayOnce(store);
    return [column(incoming ? 'get' : 'give', fromList(names[0], left)), column(incoming ? 'give' : 'get', fromList(names[1], right))];
  }

  const gift = modal.querySelector('.modal-trade__swap-gift__icon')?.closest('.modal-trade__swap-el');
  if (!gift) return null;
  const side = readPanel(gift);
  if (known && shows(known.give.cards, side)) return [column('give', known.give)];
  const trade = incoming ? matchTrade(store.trades(), [nameOf(gift), null], [side, whole([])]) : null;
  if (trade) return [column('get', whole(trade.offer))];
  return [column(incoming ? 'get' : 'give', fromList(nameOf(gift), side))];
}

const readModals = (store) =>
  [...document.querySelectorAll(MODAL)]
    .map((modal) => ({ modal, host: modal.querySelector('.modal-trade__footer') }))
    .filter(({ host }) => host)
    .map(({ modal, host }) => ({ host, placement: 'start', columns: readConstructor(modal) ?? readReview(modal, store) }));

const readPreviewList = (list) => ({
  cards: readCards(list.querySelector('.card-preview-list__slider')),
  hidden: numberIn(list.querySelector('.card-preview-list-show-more')),
});

const readHistory = (store) =>
  [...document.querySelectorAll('.card-trade')].map((host) => {
    const lists = [...host.children].filter((el) => el.matches('.card-preview-list'));
    const names = lists.map(nameOf);
    const trade = lists.length === 2 ? matchTrade(store.trades(), names, lists.map(readPreviewList)) : null;
    return { host, placement: 'end', columns: trade ? viewerColumns(trade, store.viewerId(), names) : null };
  });

const readOffers = (store) =>
  [...document.querySelectorAll('.offer-card')].map((host) => {
    const top = { cards: readCards(host.querySelector('.offer-card__top-list')), hidden: numberIn(host.querySelector('.offer-card__top-more')) };
    const middle = { cards: readCards(host.querySelector('.offer-card__cnt-list')), hidden: numberIn(host.querySelector('.offer-card__cnt-el-more')) };
    const author = host.querySelector('.offer-card__top h3 span')?.textContent.trim() ?? '';
    const offer = matchOffer(store.offers(), author, top, middle);
    if (!offer) return { host, placement: 'end', columns: null };
    const [give, get] = offer.viewerDidAuthor ? [offer.offer, offer.request] : [offer.request, offer.offer];
    return {
      host,
      placement: 'end',
      caption: offer.viewerDidAuthor ? 'Если примут' : 'Если примешь',
      columns: [column('give', whole(give)), column('get', whole(get))],
    };
  });

const readNotifications = (store) =>
  [...document.querySelectorAll('.card-notif__info')].flatMap((host) => {
    const counts = [...host.querySelectorAll('.card-notif__info-hint')].map((el) => NOTIFICATION_COUNTS.exec(el.textContent)).find(Boolean);
    if (!counts) return [];
    const sender = host.closest('.card-notif')?.querySelector('.card-notif__source-title')?.textContent.trim() ?? '';
    const trade = matchTradeByCounts(store.trades(), sender, Number(counts[1]), Number(counts[2]));
    return [{ host, placement: 'end', columns: trade ? [column('get', whole(trade.offer)), column('give', whole(trade.request))] : null }];
  });

export function readTradePlaces(store) {
  rememberCardLists();
  return [...readModals(store), ...readHistory(store), ...readOffers(store), ...readNotifications(store)];
}
