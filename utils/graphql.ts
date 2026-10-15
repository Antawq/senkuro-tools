import { PRIMARY_DOMAIN } from './hosts';
import { MS_PER_SECOND } from './time';

export const API_ENDPOINT = `https://api.${PRIMARY_DOMAIN}/graphql`;

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const BACKOFF_FACTOR = 2;
const MAX_WAIT_MS = 8000;
const JITTER = 0.25;
const RETRIED_STATUSES = new Set([429, 502, 503, 504]);
const UNAUTHORIZED_CODES = new Set(['NOT_AUTHORIZED', 'UNAUTHENTICATED']);
const HTTP_UNAUTHORIZED = 401;
const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' };

const isRedirect = (status: number): boolean => status >= 300 && status < 400;

export type Failure = 'network' | 'redirect' | 'http' | 'decode' | 'graphql' | 'limit';

export class ApiError extends Error {
  readonly failure: Failure;
  readonly status: number | null;
  readonly unauthorized: boolean;

  constructor(failure: Failure, status: number | null = null, unauthorized = false) {
    super(status === null ? `api ${failure}` : `api ${failure} ${status}`);
    this.name = 'ApiError';
    this.failure = failure;
    this.status = status;
    this.unauthorized = unauthorized;
  }
}

export interface Transport {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const browserTransport: Transport = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export type Variables = Readonly<Record<string, unknown>>;

const backoffMs = (attempt: number, random: () => number): number =>
  Math.min(BASE_DELAY_MS * BACKOFF_FACTOR ** (attempt - 1), MAX_WAIT_MS) * (1 + random() * JITTER);

const retryDelayMs = (response: Response, attempt: number, random: () => number): number => {
  const header = response.headers.get('retry-after');
  return header && /^\d+$/.test(header) ? Number(header) * MS_PER_SECOND : backoffMs(attempt, random);
};

const isUnauthorizedEntry = (entry: unknown): boolean => {
  const code = (entry as { extensions?: { code?: unknown } } | null)?.extensions?.code;
  return typeof code === 'string' && UNAUTHORIZED_CODES.has(code);
};

async function decode<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError('http', response.status, response.status === HTTP_UNAUTHORIZED);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('decode');
  }
  const { data, errors } = (payload && typeof payload === 'object' ? payload : {}) as { data?: unknown; errors?: unknown };
  if (Array.isArray(errors) && errors.length > 0) throw new ApiError('graphql', null, errors.some(isUnauthorizedEntry));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('decode');
  return data as T;
}

export async function execute<T>(
  token: string | null,
  document: string,
  operationName: string,
  variables: Variables,
  transport: Transport = browserTransport
): Promise<T> {
  const body = JSON.stringify({ query: document, operationName, variables });
  const headers: Record<string, string> = { ...JSON_HEADERS, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await transport.fetch(API_ENDPOINT, {
        method: 'POST',
        headers,
        body,
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      if (attempt >= MAX_ATTEMPTS) throw new ApiError('network');
      await transport.sleep(backoffMs(attempt, transport.random));
      continue;
    }
    if (response.type === 'opaqueredirect' || isRedirect(response.status)) throw new ApiError('redirect', response.status || null);
    if (RETRIED_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
      const wait = retryDelayMs(response, attempt, transport.random);
      if (wait <= MAX_WAIT_MS) {
        response.body?.cancel().catch(() => undefined);
        await transport.sleep(wait);
        continue;
      }
    }
    return decode<T>(response);
  }
}
