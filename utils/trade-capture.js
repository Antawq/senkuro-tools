export const TRADES_EVENT = 'senkutools:trades';
export const REPLAY_EVENT = 'senkutools:trades-replay';

const preview = (item) => ({ slug: item?.card?.slug ?? null, quantity: item?.quantity ?? 1, shard: Boolean(item?.shard) });

const previews = (list) => (Array.isArray(list) ? list.map(preview) : null);

const person = (user) => ({ id: user?.id ?? null, name: user?.name ?? '' });

function describe(node) {
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

export function captureTrades(json) {
  const items = [];
  let viewerId = null;
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const item = describe(node);
    if (item) items.push(item);
    if (typeof node.viewer?.user?.id === 'string') viewerId = node.viewer.user.id;
    Object.values(node).forEach(visit);
  };
  visit(json);
  return { viewerId, items };
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const captureServerPayload = (payload) =>
  Object.values(payload?.graphql ?? {})
    .map((entry) => (typeof entry?.data === 'string' ? parseJson(entry.data) : null))
    .filter(Boolean)
    .map(captureTrades);

export function createTradeStore() {
  const items = new Map();
  let viewerId = null;
  return {
    add(found) {
      if (found?.viewerId) viewerId = found.viewerId;
      for (const item of found?.items ?? []) items.set(`${item.kind}:${item.id}`, item);
    },
    viewerId: () => viewerId,
    trades: () => [...items.values()].filter((item) => item.kind === 'trade'),
    offers: () => [...items.values()].filter((item) => item.kind === 'offer'),
    snapshot: () => ({ viewerId, items: [...items.values()] }),
  };
}

const STREAMED = /multipart|event-stream/;

const requestUrl = (input) => (typeof input === 'string' ? input : (input?.url ?? String(input ?? '')));

export const isGraphqlRequest = (input, base) => {
  try {
    return new URL(requestUrl(input), base).pathname.endsWith('/graphql');
  } catch {
    return false;
  }
};

export function installCapture(win) {
  const store = createTradeStore();
  const publish = (found) => win.document.dispatchEvent(new win.CustomEvent(TRADES_EVENT, { detail: JSON.stringify(found) }));
  const take = (found) => {
    if (!found.viewerId && found.items.length === 0) return;
    store.add(found);
    publish(found);
  };

  const handle = (json) => json && take(captureTrades(json));
  const observe = (response) => {
    for (const method of ['json', 'text']) {
      const read = response[method].bind(response);
      response[method] = () =>
        read().then((value) => {
          Promise.resolve(method === 'json' ? value : parseJson(value))
            .then(handle)
            .catch(() => null);
          return value;
        });
    }
    return response;
  };

  const nativeFetch = win.fetch;
  win.fetch = function (...args) {
    const pending = nativeFetch.apply(this, args);
    if (!isGraphqlRequest(args[0], win.location.href)) return pending;
    return pending.then((response) => (STREAMED.test(response.headers.get('content-type') ?? '') ? response : observe(response)));
  };

  win.document.addEventListener(REPLAY_EVENT, () => {
    captureServerPayload(win.__SENKURO__).forEach((found) => store.add(found));
    publish(store.snapshot());
  });
}

export function listenForTrades(store, onChange) {
  document.addEventListener(TRADES_EVENT, (event) => {
    const found = typeof event.detail === 'string' ? parseJson(event.detail) : null;
    if (!found) return;
    store.add(found);
    onChange();
  });
  document.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}
