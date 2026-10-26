import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// A response whose headers arrive but whose body never finishes — a stalled
// venue connection — honouring the request's abort signal like real fetch.
function stalledBodyFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  }));
}

describe('fetchWithTimeout', () => {
  it('times out a stalled response body on browsers without AbortSignal.timeout (n1)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { timeout: undefined }));
    vi.stubGlobal('fetch', stalledBodyFetch());
    const res = await fetchWithTimeout('/api/x', {}, 1_000);
    const body = res.json();
    const settled = expect(body).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
  });

  it('times out a stalled response body via AbortSignal.timeout', async () => {
    vi.stubGlobal('fetch', stalledBodyFetch());
    const res = await fetchWithTimeout('/api/x', {}, 20);
    await expect(res.json()).rejects.toThrow();
  });
});

// apiRequest — every page's requests go through it. Fresh module per test:
// it keeps the CSRF token and the redirect flag in module state.
describe('apiRequest', () => {
  let assign: ReturnType<typeof vi.fn>;
  let calls: { url: string; init: RequestInit }[];
  let replies: Response[];
  let csrfFetches: number;

  async function load() {
    vi.resetModules();
    return import('./client');
  }

  function reply(status: number, body?: unknown) {
    replies.push(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  }

  beforeEach(() => {
    assign = vi.fn();
    calls = [];
    replies = [];
    csrfFetches = 0;
    vi.stubGlobal('window', { location: { pathname: '/t/x/r/1', assign } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === '/api/auth/csrf') {
          csrfFetches++;
          return new Response(JSON.stringify({ csrfToken: `t${csrfFetches}` }), { status: 200 });
        }
        calls.push({ url, init });
        return replies.shift() ?? new Response('{}', { status: 200 });
      }),
    );
  });

  const header = (i: number, name: string) => (calls[i].init.headers as Record<string, string>)[name];

  it('retries once with a fresh token when the CSRF token is rejected', async () => {
    const { apiRequest } = await load();
    reply(403, { error: 'FST_CSRF_INVALID_TOKEN' });
    reply(200, { ok: true });
    await expect(apiRequest('/things', { method: 'POST', body: { a: 1 } })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect([header(0, 'x-csrf-token'), header(1, 'x-csrf-token')]).toEqual(['t1', 't2']);
  });

  it('retries only once, then reports the rejection', async () => {
    const { apiRequest, ApiError } = await load();
    reply(403, { error: 'FST_CSRF_INVALID_TOKEN' });
    reply(403, { error: 'FST_CSRF_INVALID_TOKEN' });
    const err = await apiRequest('/things', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'FST_CSRF_INVALID_TOKEN' });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 403 that is not a CSRF rejection', async () => {
    const { apiRequest } = await load();
    reply(403, { error: 'FORBIDDEN' });
    await expect(apiRequest('/things', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(calls).toHaveLength(1);
  });

  it('sends a 401 to sign-in, carrying the current page', async () => {
    const { apiRequest } = await load();
    reply(401, { error: 'UNAUTHORIZED' });
    await expect(apiRequest('/things')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/t/x/r/1')}`);
  });

  it('leaves a 401 to the caller with skipAuthRedirect (e.g. wrong password)', async () => {
    const { apiRequest } = await load();
    reply(401, { error: 'INVALID_CREDENTIALS' });
    await expect(apiRequest('/auth/login', { method: 'POST', body: {}, skipAuthRedirect: true })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('sends no Content-Type on a bodyless POST (Fastify 400s on an empty JSON body)', async () => {
    const { apiRequest } = await load();
    await apiRequest('/auth/logout', { method: 'POST' });
    expect(header(0, 'Content-Type')).toBeUndefined();
    expect(header(0, 'x-csrf-token')).toBe('t1');
  });

  it('fetches no CSRF token for a GET', async () => {
    const { apiRequest } = await load();
    await apiRequest('/things');
    expect(csrfFetches).toBe(0);
    expect(header(0, 'x-csrf-token')).toBeUndefined();
  });

  it('returns undefined for 204 No Content', async () => {
    const { apiRequest } = await load();
    replies.push(new Response(null, { status: 204 }));
    await expect(apiRequest('/things/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
