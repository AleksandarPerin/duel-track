import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(storage: Partial<Storage>) {
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  return import('./sessionUser');
}

describe('sessionUser', () => {
  it('follows storage when it works, so a sign-out in another tab is seen here', async () => {
    const map = new Map<string, string>();
    const s = await load({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    });
    s.setSessionUserId('judge-a');
    expect(s.getSessionUserId()).toBe('judge-a');
    map.clear(); // another tab signed out
    expect(s.getSessionUserId()).toBeNull();
  });

  it('keeps the id in memory when storage rejects writes but still reads (n2)', async () => {
    const s = await load({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    });
    s.setSessionUserId('judge-a');
    expect(s.getSessionUserId()).toBe('judge-a');
    s.setSessionUserId(null);
    expect(s.getSessionUserId()).toBeNull();
  });

  it('remembers the display name with the id, and forgets both on sign-out', async () => {
    const map = new Map<string, string>();
    const s = await load({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    });
    s.setSessionUserId('judge-a', 'Judge Ana');
    expect(s.getSessionUserName()).toBe('Judge Ana');
    s.setSessionUserId(null);
    expect(s.getSessionUserName()).toBeNull();
    expect(map.size).toBe(0);
  });

  it('keeps the id in memory when storage throws entirely', async () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const s = await load({ getItem: boom, setItem: boom, removeItem: boom });
    s.setSessionUserId('judge-a');
    expect(s.getSessionUserId()).toBe('judge-a');
  });
});
