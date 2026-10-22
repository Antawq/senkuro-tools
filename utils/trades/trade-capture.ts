import { debugLogger } from '../shared/debug';
import { parseJson } from '../shared/json';
import type { CardRef } from '../shared/trade-value';

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
  createdAt: string | null;
  status: string | null;
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

interface GraphUser {
  id?: string;
  name?: string | null;
}

interface GraphPreview {
  quantity?: number;
  shard?: boolean | number;
  slug?: string;
  card?: { slug?: string };
}

interface GraphNode {
  __typename?: string;
  id?: string;
  offer?: unknown;
  request?: unknown;
  source?: GraphUser;
  destination?: GraphUser;
  user?: GraphUser;
  viewerDidAuthor?: boolean;
  createdAt?: unknown;
  status?: unknown;
  tradeStatus?: unknown;
  viewer?: { user?: { id?: unknown } };
}

interface ServerPayload {
  graphql?: Record<string, { data?: unknown } | undefined>;
}

type CapturingWindow = Window & typeof globalThis & { __SENKURO__?: ServerPayload };

const preview = (item: GraphPreview | undefined): CardRef => ({
  slug: item?.card?.slug ?? item?.slug ?? null,
  quantity: item?.quantity ?? 1,
  shard: Boolean(item?.shard),
});

const previews = (list: unknown): CardRef[] | null => (Array.isArray(list) ? (list as (GraphPreview | undefined)[]).map(preview) : null);

const person = (user: GraphUser | undefined): Person => ({ id: user?.id ?? null, name: user?.name ?? '' });

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function kindOf(node: GraphNode): CapturedItem['kind'] | null {
  if (node.__typename === 'CardTrade') return 'trade';
  if (node.__typename === 'CardOffer') return 'offer';
  if (node.__typename !== undefined) return null;
  if (node.source && node.destination) return 'trade';
  return node.user && typeof node.viewerDidAuthor === 'boolean' ? 'offer' : null;
}

function describe(node: GraphNode): CapturedItem | null {
  const offer = previews(node.offer);
  const request = previews(node.request);
  if (!node.id || !offer || !request) return null;
  const kind = kindOf(node);
  if (kind === 'trade') {
    const [source, destination] = [person(node.source), person(node.destination)];
    return { kind, id: node.id, source, destination, createdAt: text(node.createdAt), status: text(node.status ?? node.tradeStatus), offer, request };
  }
  if (kind === 'offer') return { kind, id: node.id, author: person(node.user), viewerDidAuthor: Boolean(node.viewerDidAuthor), offer, request };
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

const isGraphqlRequest = (input: unknown, base: string): boolean => {
  try {
    return new URL(requestUrl(input), base).pathname.endsWith('/graphql');
  } catch {
    return false;
  }
};

export function installCapture(win: CapturingWindow): void {
  const debug = debugLogger(win);
  const store = createTradeStore();
  const publish = (found: Capture) => win.document.dispatchEvent(new win.CustomEvent(TRADES_EVENT, { detail: JSON.stringify(found) }));
  const take = (found: Capture) => {
    if (!found.viewerId && found.items.length === 0) return;
    store.add(found);
    publish(found);
  };
  const handle = (json: unknown) => {
    if (!json) return;
    const found = captureTrades(json);
    debug('answer read', { top: Object.keys((json as { data?: object }).data ?? json), items: found.items.length, viewer: Boolean(found.viewerId) });
    take(found);
  };

  const readCopy = async (response: Response): Promise<void> => {
    try {
      const text = await response.clone().text();
      win.setTimeout(() => handle(parseJson(text)));
    } catch (error) {
      debug('answer not read', error instanceof Error ? error.name : String(error));
    }
  };

  const nativeFetch = win.fetch.bind(win);
  win.fetch = (...args: Parameters<typeof fetch>) => {
    const pending = nativeFetch(...args);
    if (!isGraphqlRequest(args[0], win.location.href)) return pending;
    return pending.then(async (response) => {
      const type = response.headers.get('content-type') ?? '';
      debug('graphql answer', { status: response.status, type, streamed: STREAMED.test(type) });
      if (!STREAMED.test(type)) await readCopy(response);
      return response;
    });
  };
  debug('capture installed', win.document.readyState);

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
