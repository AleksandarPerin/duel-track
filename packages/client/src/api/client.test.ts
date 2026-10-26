import { afterEach, describe, expect, it, vi } from 'vitest';
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
