import { describe, expect, it, vi } from 'vitest';

import type { ApiError } from '../utils/shared/graphql';
import { API_ENDPOINT, execute, type Transport } from '../utils/shared/graphql';

const TOKEN = 'v4.local.secret-token-value';

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const transportOf = (replies: (Response | Error)[]) => {
  const queue = [...replies];
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const transport: Transport = {
    fetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (!next) return Promise.reject(new Error('no reply left'));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next instanceof Response ? next.clone() : next);
    }),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
  };
  return { transport, calls, sleeps };
};

const run = (replies: (Response | Error)[]) => {
  const harness = transportOf(replies);
  return { ...harness, result: execute<{ ok: boolean }>(TOKEN, 'query Q { ok }', 'Q', { a: 1 }, harness.transport) };
};

const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the request to fail');
};

describe('execute', () => {
  it('posts the operation to the fixed endpoint with the token and returns the data', async () => {
    const { result, calls } = run([reply({ data: { ok: true } })]);
    expect(await result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(API_ENDPOINT);
    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(init.body as string)).toEqual({ query: 'query Q { ok }', operationName: 'Q', variables: { a: 1 } });
  });

  it('sends no cookies, no referrer and never follows a redirect', async () => {
    const { result, calls } = run([reply({ data: {} })]);
    await result;
    expect(calls[0]?.init).toMatchObject({ credentials: 'omit', redirect: 'manual', referrerPolicy: 'no-referrer' });
    expect(calls[0]?.init.signal).toBeDefined();
  });

  it('answers an error for a redirect instead of following it', async () => {
    const found = await failure(run([reply('', 302, { location: 'https://evil.example/' })]).result);
    expect(found).toMatchObject({ failure: 'redirect', status: 302 });
    const opaque = { type: 'opaqueredirect', status: 0, headers: new Headers() } as unknown as Response;
    expect(await failure(run([opaque]).result)).toMatchObject({ failure: 'redirect', status: null });
  });

  it('tries again after a transient status and waits longer each time', async () => {
    const { result, sleeps, calls } = run([reply('', 503), reply('', 502), reply({ data: { ok: true } })]);
    expect(await result).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after three attempts', async () => {
    const { result, calls, sleeps } = run([reply('', 503)]);
    expect(await failure(result)).toMatchObject({ failure: 'http', status: 503 });
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('waits as long as the server asks when that is short', async () => {
    const { result, sleeps } = run([reply('', 429, { 'retry-after': '2' }), reply({ data: { ok: true } })]);
    await result;
    expect(sleeps).toEqual([2000]);
  });

  it('does not wait for a long retry-after and reports it', async () => {
    const { result, sleeps, calls } = run([reply('', 429, { 'retry-after': '120' })]);
    expect(await failure(result)).toMatchObject({ failure: 'http', status: 429 });
    expect(sleeps).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('stops at a 429 that names no wait instead of asking again', async () => {
    const { result, sleeps, calls } = run([reply('', 429)]);
    expect(await failure(result)).toMatchObject({ failure: 'http', status: 429 });
    expect(sleeps).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('retries a network error and then reports it', async () => {
    const recovered = run([new TypeError('Failed to fetch'), reply({ data: { ok: true } })]);
    expect(await recovered.result).toEqual({ ok: true });
    expect(recovered.sleeps).toEqual([500]);
    const dead = run([new TypeError('Failed to fetch')]);
    expect(await failure(dead.result)).toMatchObject({ failure: 'network', status: null });
    expect(dead.calls).toHaveLength(3);
  });

  it('reports an http error and tells a rejected token from the rest', async () => {
    expect(await failure(run([reply('nope', 500)]).result)).toMatchObject({ failure: 'http', status: 500, unauthorized: false });
    expect(await failure(run([reply('nope', 401)]).result)).toMatchObject({ failure: 'http', status: 401, unauthorized: true });
  });

  it('reports graphql errors and tells an unauthorized one', async () => {
    const unauthorized = { errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }] };
    const other = { errors: [{ message: 'no', extensions: { code: 'INTERNAL' } }], data: { ok: true } };
    expect(await failure(run([reply(unauthorized)]).result)).toMatchObject({ failure: 'graphql', unauthorized: true });
    expect(await failure(run([reply({ errors: [{ extensions: { code: 'NOT_AUTHORIZED' } }] })]).result)).toMatchObject({ unauthorized: true });
    expect(await failure(run([reply(other)]).result)).toMatchObject({ failure: 'graphql', unauthorized: false });
  });

  it('reports an answer that is not a graphql data object', async () => {
    expect(await failure(run([reply('<html>blocked</html>')]).result)).toMatchObject({ failure: 'decode' });
    expect(await failure(run([reply({})]).result)).toMatchObject({ failure: 'decode' });
    expect(await failure(run([reply({ data: [1] })]).result)).toMatchObject({ failure: 'decode' });
    expect(await failure(run([reply({ data: null })]).result)).toMatchObject({ failure: 'decode' });
  });

  it('never puts the token or an answer body into an error', async () => {
    const errors = [
      await failure(run([reply(`denied ${TOKEN}`, 500)]).result),
      await failure(run([reply({ errors: [{ message: `bad ${TOKEN}` }] })]).result),
      await failure(run([new TypeError(`failed ${TOKEN}`)]).result),
    ];
    for (const error of errors) {
      expect(error.message).not.toContain(TOKEN);
      expect(String(error)).not.toContain(TOKEN);
      expect(JSON.stringify(error)).not.toContain(TOKEN);
    }
  });

  it('fails with network error immediately when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = transportOf([reply({ data: { ok: true } })]);
    const promise = execute<{ ok: boolean }>(TOKEN, 'query Q { ok }', 'Q', { a: 1 }, harness.transport, controller.signal);
    expect(await failure(promise)).toMatchObject({ failure: 'network' });
    expect(harness.calls).toHaveLength(0);
  });
});
