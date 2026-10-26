import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completePendingLogout, logoutDuringNavigation, clearPendingLogout } from './auth';

// Revoking the refresh token when sign-out happens while the page is
// already navigating away (R5-m2): keepalive alone isn't enough — older
// Firefox ignores it, and an offline moment loses it — so the attempt is
// remembered and finished on the next load or before the next sign-in.

let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const logoutCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/auth/logout');

describe('pending logout', () => {
  it('sends a keepalive logout and remembers it until it is confirmed', async () => {
    logoutDuringNavigation();
    expect(logoutCalls()).toHaveLength(1);
    expect(logoutCalls()[0][1]).toMatchObject({ method: 'POST', credentials: 'include', keepalive: true });
    expect(storage.size).toBe(1);
  });

  it('finishes a remembered logout later, and forgets it once the server confirms', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    logoutDuringNavigation();
    await completePendingLogout();
    expect(logoutCalls()).toHaveLength(2);
    expect(storage.size).toBe(0);
  });

  it('keeps it remembered while the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    logoutDuringNavigation();
    await completePendingLogout();
    expect(storage.size).toBe(1);
  });

  it('keeps it remembered when the server answers with an error', async () => {
    // Only a confirmed logout (2xx) means the refresh token was revoked.
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
    logoutDuringNavigation();
    await completePendingLogout();
    expect(logoutCalls()).toHaveLength(2);
    expect(storage.size).toBe(1);
  });

  it('does nothing when no logout is pending', async () => {
    await completePendingLogout();
    expect(logoutCalls()).toHaveLength(0);
  });

  it('is cleared by a successful sign-in, so a late retry never signs out the new user', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    logoutDuringNavigation();
    clearPendingLogout();
    fetchMock.mockClear();
    await completePendingLogout();
    expect(logoutCalls()).toHaveLength(0);
  });
});
