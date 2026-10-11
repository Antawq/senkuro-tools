import type { CardOffersData, CardTradesData } from '@antawq/senkuro';

import type { CardRef } from './trade-value';

export const TRADES_EVENT = 'senkutools:trades';
export const REPLAY_EVENT = 'senkutools:trades-replay';

export interface Person {
  id: string | null;
  name: string;
}

export interface Trade {
  kind: 'trade';
  id: string;
  source: Person;
  destination: Person;
  offer: CardRef[];
  request: CardRef[];
}

export interface Offer {
  kind: 'offer';
  id: string;
  author: Person;
  viewerDidAuthor: boolean;
  offer: CardRef[];
  request: CardRef[];
}

export type CapturedItem = Trade | Offer;

export interface Capture {
  viewerId: string | null;
  items: CapturedItem[];
}

export interface TradeStore {
  add(found: Partial<Capture> | null | undefined): void;
  viewerId(): string | null;
  trades(): Trade[];
  offers(): Offer[];
  snapshot(): Capture;
}

type TradeNode = CardTradesData['cardTrades']['edges'][number]['node'];
type OfferNode = CardOffersData['cardOffers']['edges'][number]['node'];
type PreviewNode = TradeNode['offer'][number];

type Optional<T> = { -readonly [Key in keyof T]?: T[Key] };

type GraphUser = Optional<Pick<TradeNode['source'] & OfferNode['user'], 'id' | 'name'>>;

type GraphPreview = Optional<Pick<PreviewNode, 'quantity' | 'shard'>> & { card?: Optional<Pick<PreviewNode['card'], 'slug'>> };

interface GraphNode {
  __typename?: string;
  id?: TradeNode['id'] & OfferNode['id'];
  offer?: unknown;
  request?: unknown;
  source?: GraphUser;
  destination?: GraphUser;
  user?: GraphUser;
  viewerDidAuthor?: boolean;
  viewer?: { user?: { id?: unknown } };
}

interface ServerPayload {
  graphql?: Record<string, { data?: unknown } | undefined>;
}

type CapturingWindow = Window & typeof globalThis & { __SENKURO__?: ServerPayload };

const preview = (item: GraphPreview | undefined): CardRef => ({ slug: item?.card?.slug ?? null, quantity: item?.quantity ?? 1, shard: Boolean(item?.shard) });

const previews = (list: unknown): CardRef[] | null => (Array.isArray(list) ? (list as (GraphPreview | undefined)[]).map(preview) : null);

const person = (user: GraphUser | undefined): Person => ({ id: user?.id ?? null, name: user?.name ?? '' });

function describe(node: GraphNode): CapturedItem | null {
  const offer = previews(node.offer);
  const request = previews(node.request);
  if (!node.id || !offer || !request) return null;
  if (node.__typename === 'CardTrade') {
    return { kind: 'trade', id: node.id, source: person(node.source), destination: person(node.destination), offer, request };
  }
  if (node.__typename === 'CardOffer') {
    return { kind: 'offer', id: node.id, author: person(node.user), viewerDidAuthor: Boolean(node.viewerDidAuthor), offer, request };
  }
  return null;
}

export function captureTrades(json: unknown): Capture {
  const items: CapturedItem[] = [];
  let viewerId: string | null = null;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const graph = node as GraphNode;
    const item = describe(graph);
    if (item) items.push(item);
    const viewer = graph.viewer?.user?.id;
    if (typeof viewer === 'string') viewerId = viewer;
    Object.values(node).forEach(visit);
  };
  visit(json);
  return { viewerId, items };
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const captureServerPayload = (payload: ServerPayload | undefined): Capture[] =>
  Object.values(payload?.graphql ?? {})
    .map((entry) => (typeof entry?.data === 'string' ? parseJson(entry.data) : null))
    .filter((json) => json !== null)
    .map(captureTrades);

export function createTradeStore(): TradeStore {
  const items = new Map<string, CapturedItem>();
  let viewerId: string | null = null;
  return {
    add(found) {
      if (found?.viewerId) viewerId = found.viewerId;
      for (const item of found?.items ?? []) items.set(`${item.kind}:${item.id}`, item);
    },
    viewerId: () => viewerId,
    trades: () => [...items.values()].filter((item): item is Trade => item.kind === 'trade'),
    offers: () => [...items.values()].filter((item): item is Offer => item.kind === 'offer'),
    snapshot: () => ({ viewerId, items: [...items.values()] }),
  };
}

const STREAMED = /multipart|event-stream/;

const requestUrl = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as { url?: string } | null)?.url ?? '';
};

export const isGraphqlRequest = (input: unknown, base: string): boolean => {
  try {
    return new URL(requestUrl(input), base).pathname.endsWith('/graphql');
  } catch {
    return false;
  }
};

export function installCapture(win: CapturingWindow): void {
  const store = createTradeStore();
  const publish = (found: Capture) => win.document.dispatchEvent(new win.CustomEvent(TRADES_EVENT, { detail: JSON.stringify(found) }));
  const take = (found: Capture) => {
    if (!found.viewerId && found.items.length === 0) return;
    store.add(found);
    publish(found);
  };
  const handle = (json: unknown) => {
    if (json) take(captureTrades(json));
  };
  const later = (json: unknown) => {
    Promise.resolve(json)
      .then(handle)
      .catch(() => null);
  };

  const observe = (response: Response): Response => {
    const readJson = response.json.bind(response);
    const readText = response.text.bind(response);
    response.json = () =>
      readJson().then((value: unknown) => {
        later(value);
        return value;
      });
    response.text = () =>
      readText().then((value) => {
        later(parseJson(value));
        return value;
      });
    return response;
  };

  const nativeFetch = win.fetch.bind(win);
  win.fetch = (...args: Parameters<typeof fetch>) => {
    const pending = nativeFetch(...args);
    if (!isGraphqlRequest(args[0], win.location.href)) return pending;
    return pending.then((response) => (STREAMED.test(response.headers.get('content-type') ?? '') ? response : observe(response)));
  };

  win.document.addEventListener(REPLAY_EVENT, () => {
    captureServerPayload(win.__SENKURO__).forEach((found) => store.add(found));
    publish(store.snapshot());
  });
}

export function listenForTrades(store: TradeStore, onChange: () => void): void {
  document.addEventListener(TRADES_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    const found = typeof detail === 'string' ? (parseJson(detail) as Partial<Capture> | null) : null;
    if (!found) return;
    store.add(found);
    onChange();
  });
  document.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}
