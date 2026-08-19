import { describe, expect, it } from 'vitest';
import { isStale } from './standingsCache';

describe('isStale', () => {
  it('is not stale immediately after fetching', () => {
    expect(isStale(Date.now())).toBe(false);
  });

  it('is not stale just under the default max age', () => {
    expect(isStale(Date.now() - (5 * 60_000 - 1000))).toBe(false);
  });

  it('is stale once past the default max age', () => {
    expect(isStale(Date.now() - (5 * 60_000 + 1000))).toBe(true);
  });

  it('respects a custom max age', () => {
    expect(isStale(Date.now() - 1000, 500)).toBe(true);
    expect(isStale(Date.now() - 1000, 5000)).toBe(false);
  });
});
