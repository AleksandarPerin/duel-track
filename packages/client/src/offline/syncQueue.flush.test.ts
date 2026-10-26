import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultInput } from '@dueltrack/shared';
import { openDb, QueuedResult } from './db';
import {
  countUnsentForUser,
  CSRF_FAILURE_LIMIT,
  enqueueResult,
  flushQueue,
  getQueuedStatusForTournament,
  parkPendingForSignIn,
  resumeAuthRequired,
  STALE_SYNCING_MS,
} from './syncQueue';
import { setSessionUserId } from '../api/sessionUser';
import { CSRF_PRIME_TIMEOUT_MS, REQUEST_TIMEOUT_MS, resetCsrfToken } from '../api/client';
import { RESULT_ALREADY_RECORDED_MESSAGE } from '../api/resultErrors';

// Real flush logic against an in-memory IndexedDB (fake-indexeddb) with a
// scripted fetch — the parts of the queue that unit tests on pure helpers
// never reached: multi-tab overlap, session expiry, shared devices.

const T = 'tournament-1';
const BODY: ResultInput = { outcome: 'player1_win', player1_game_wins: 2, player2_game_wins: 0, games_drawn: 0 };

// 'throw' = the request itself fails (offline, connection reset).
type Reply = { status: number; error?: string } | 'throw' | (() => Promise<{ status: number; error?: string }>);
let replies: Map<string, Reply>;
let posted: string[];
// Every result POST as sent, for checking what actually goes over the wire.
let requests: { pairingId: string; init: RequestInit }[];
let csrfFetches: number;
// Runs while the CSRF token is being fetched (before the POST it precedes).
let onCsrfFetch: (() => void) | null;
let assign: ReturnType<typeof vi.fn>;
let location: { pathname: string; search: string; assign: typeof assign };

function pairingOf(url: string): string {
  return /\/pairings\/([^/]+)\/result$/.exec(url)![1];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function put(record: Partial<QueuedResult> & { id: string; pairingId: string }): Promise<void> {
  const db = await openDb();
  await db.put('queuedResults', { tournamentId: T, body: BODY, createdAt: Date.now(), status: 'pending', ...record });
}

async function get(id: string): Promise<QueuedResult | undefined> {
  return (await openDb()).get('queuedResults', id);
}

beforeEach(async () => {
  replies = new Map();
  posted = [];
  requests = [];
  csrfFetches = 0;
  onCsrfFetch = null;
  assign = vi.fn();
  location = { pathname: `/t/${T}/r/1`, search: '', assign };
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location, setTimeout }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/auth/csrf') {
        csrfFetches++;
        onCsrfFetch?.();
        return json(200, { csrfToken: `csrf-${csrfFetches}` });
      }
      const pairingId = pairingOf(url);
      posted.push(pairingId);
      requests.push({ pairingId, init });
      const reply = replies.get(pairingId) ?? { status: 201 };
      if (reply === 'throw') throw new TypeError('Failed to fetch');
      const { status, error } = typeof reply === 'function' ? await reply() : reply;
      return json(status, error ? { error } : {});
    }),
  );
  resetCsrfToken();
  setSessionUserId('judge-a');
  await (await openDb()).clear('queuedResults');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flushQueue — several tabs on one device (M1)', () => {
  it("leaves a record another tab is still sending alone", async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', status: 'syncing', syncingSince: Date.now() });
    await flushQueue();
    expect(posted).toEqual([]);
    expect((await get('r1'))?.status).toBe('syncing');
  });

  it('reclaims a record whose sending tab died (stale syncingSince, or none from an older version)', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', status: 'syncing', syncingSince: Date.now() - STALE_SYNCING_MS - 1 });
    await put({ id: 'r2', pairingId: 'p2', userId: 'judge-a', status: 'syncing' });
    await flushQueue();
    expect(posted.sort()).toEqual(['p1', 'p2']);
    expect(await get('r1')).toBeUndefined();
    expect(await get('r2')).toBeUndefined();
  });

  it("does not resurrect a record deleted while its request was in flight", async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    // The other tab's copy of the same POST won (201) and deleted the record
    // while this one was in flight; this tab then gets the 409.
    replies.set('p1', async () => {
      await (await openDb()).delete('queuedResults', 'r1');
      return { status: 409, error: 'RESULT_ALREADY_ENTERED' };
    });
    await flushQueue();
    expect(await get('r1')).toBeUndefined();
  });

  it('skips a pending record another tab claimed after this pass listed it', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', createdAt: 1 });
    await put({ id: 'r2', pairingId: 'p2', userId: 'judge-a', createdAt: 2 });
    replies.set('p1', async () => {
      const db = await openDb();
      const r2 = (await db.get('queuedResults', 'r2'))!;
      await db.put('queuedResults', { ...r2, status: 'syncing', syncingSince: Date.now() });
      return { status: 201 };
    });
    await flushQueue();
    expect(posted).toEqual(['p1']);
    expect((await get('r2'))?.status).toBe('syncing');
  });
});

describe('flushQueue — expired session (M2)', () => {
  it('parks every pending record on the first 401 and redirects once, back to this page', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', createdAt: 1 });
    await put({ id: 'r2', pairingId: 'p2', userId: 'judge-a', createdAt: 2 });
    await put({ id: 'r3', pairingId: 'p3', userId: 'judge-a', createdAt: 3 });
    replies.set('p1', { status: 401 });
    await flushQueue();
    expect(posted).toEqual(['p1']);
    for (const id of ['r1', 'r2', 'r3']) expect((await get(id))?.status).toBe('auth-required');
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent(`/t/${T}/r/1`)}`);
  });

  it('never reloads the login page itself (would wipe the form and its ?redirect)', async () => {
    location.pathname = '/login';
    location.search = `?redirect=${encodeURIComponent(`/t/${T}/r/1`)}`;
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    replies.set('p1', { status: 401 });
    await flushQueue();
    expect((await get('r1'))?.status).toBe('auth-required');
    expect(assign).not.toHaveBeenCalled();
  });

  it('parkPendingForSignIn parks the rest of the queue (live-entry 401 path)', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    await enqueueResult(T, 'p2', BODY, 'auth-required');
    await parkPendingForSignIn();
    expect((await get('r1'))?.status).toBe('auth-required');
    await flushQueue();
    expect(posted).toEqual([]);
  });
});

describe('shared device — results belong to the judge who entered them (M3)', () => {
  it('stamps the signed-in user on enqueue', async () => {
    await enqueueResult(T, 'p1', BODY);
    const [record] = await (await openDb()).getAll('queuedResults');
    expect(record.userId).toBe('judge-a');
  });

  it("never sends another user's queued result under the current session", async () => {
    await put({ id: 'mine', pairingId: 'p1', userId: 'judge-a' });
    await put({ id: 'theirs', pairingId: 'p2', userId: 'judge-b' });
    await flushQueue();
    expect(posted).toEqual(['p1']);
    expect((await get('theirs'))?.status).toBe('pending');
  });

  it('sends nothing owned while nobody is signed in', async () => {
    setSessionUserId(null);
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    await flushQueue();
    expect(posted).toEqual([]);
  });

  it("resumes only the signing-in user's parked results", async () => {
    await put({ id: 'a', pairingId: 'p1', userId: 'judge-a', status: 'auth-required' });
    await put({ id: 'b', pairingId: 'p2', userId: 'judge-b', status: 'auth-required' });
    setSessionUserId('judge-b');
    await resumeAuthRequired('judge-b');
    expect(posted).toEqual(['p2']);
    expect((await get('a'))?.status).toBe('auth-required');
  });

  it("flags another user's queued results for the UI", async () => {
    await put({ id: 'a', pairingId: 'p1', userId: 'judge-a' });
    await put({ id: 'b', pairingId: 'p2', userId: 'judge-b', status: 'auth-required' });
    const status = await getQueuedStatusForTournament(T);
    expect(status.get('p1')?.otherUser).toBe(false);
    expect(status.get('p2')?.otherUser).toBe(true);
  });
});

describe('two tabs flushing at once (n4)', () => {
  it('sends each queued result exactly once', async () => {
    for (const [id, createdAt] of [['r1', 1], ['r2', 2], ['r3', 3]] as const) {
      await put({ id, pairingId: `p-${id}`, userId: 'judge-a', createdAt });
    }
    // Let requests overlap, as two tabs on a slow venue connection would.
    replies = new Map(
      ['p-r1', 'p-r2', 'p-r3'].map((p) => [p, () => new Promise((r) => setTimeout(() => r({ status: 201 }), 5))]),
    );
    // A second, independent copy of the queue module — its own in-tab
    // re-entrancy guard and DB connection, like another tab.
    vi.resetModules();
    const otherTab = await import('./syncQueue');
    await Promise.all([flushQueue(), otherTab.flushQueue()]);
    expect([...posted].sort()).toEqual(['p-r1', 'p-r2', 'p-r3']);
  });
});

describe('session changes while a flush is running (N4-M1)', () => {
  it("stops sending A's results once B is signed in mid-pass", async () => {
    let release!: () => void;
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', createdAt: 1 });
    await put({ id: 'r2', pairingId: 'p2', userId: 'judge-a', createdAt: 2 });
    replies.set('p1', () => new Promise((resolve) => (release = () => resolve({ status: 201 }))));
    const running = flushQueue();
    await vi.waitFor(() => expect(posted).toEqual(['p1']));
    // A signed out (the sign-out send cap fired) and B signed in meanwhile.
    setSessionUserId('judge-b');
    release();
    await running;
    expect(posted).toEqual(['p1']);
    expect((await get('r2'))?.status).toBe('pending');
  });

  it('stops once A signed out mid-pass, rather than sending with no session', async () => {
    let release!: () => void;
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', createdAt: 1 });
    await put({ id: 'r2', pairingId: 'p2', userId: 'judge-a', createdAt: 2 });
    replies.set('p1', () => new Promise((resolve) => (release = () => resolve({ status: 201 }))));
    const running = flushQueue();
    await vi.waitFor(() => expect(posted).toEqual(['p1']));
    setSessionUserId(null);
    release();
    await running;
    expect(posted).toEqual(['p1']);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('results given up on after CSRF rejections (N4-m2)', () => {
  it('are retried when their judge signs in again, and counted as unsent until then', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    replies.set('p1', { status: 403, error: 'FST_CSRF_MISSING_SECRET' });
    for (let i = 0; i < CSRF_FAILURE_LIMIT; i++) await flushQueue();
    expect((await get('r1'))?.status).toBe('failed');
    expect(await countUnsentForUser('judge-a')).toBe(1);
    replies.delete('p1');
    await resumeAuthRequired('judge-a');
    expect(await get('r1')).toBeUndefined();
  });
});

describe('countUnsentForUser — before signing out (N-M1)', () => {
  it("counts the user's results not yet on the server, and nobody else's", async () => {
    await put({ id: 'a1', pairingId: 'p1', userId: 'judge-a' });
    await put({ id: 'a2', pairingId: 'p2', userId: 'judge-a', status: 'syncing', syncingSince: Date.now() });
    await put({ id: 'a3', pairingId: 'p3', userId: 'judge-a', status: 'auth-required' });
    await put({ id: 'a4', pairingId: 'p4', userId: 'judge-a', status: 'failed', failureReason: 'x' });
    await put({ id: 'b1', pairingId: 'p5', userId: 'judge-b' });
    expect(await countUnsentForUser('judge-a')).toBe(3);
    expect(await countUnsentForUser('judge-b')).toBe(1);
  });
});

describe('flushQueue — retry limits and resume timing', () => {
  it(`marks a record failed after ${CSRF_FAILURE_LIMIT} consecutive CSRF rejections (m1)`, async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    replies.set('p1', { status: 403, error: 'FST_CSRF_MISSING_SECRET' });
    for (let i = 1; i < CSRF_FAILURE_LIMIT; i++) {
      await flushQueue();
      expect((await get('r1'))?.status).toBe('pending');
    }
    await flushQueue();
    const record = await get('r1');
    expect(record?.status).toBe('failed');
    expect(record?.failureReason).toMatch(/refresh the page/i);
  });

  it('sends parked results right away even if a flush was already running at sign-in (m2)', async () => {
    let release!: () => void;
    await put({ id: 'slow', pairingId: 'p1', userId: 'judge-a' });
    await put({ id: 'parked', pairingId: 'p2', userId: 'judge-a', status: 'auth-required' });
    replies.set('p1', () => new Promise((resolve) => (release = () => resolve({ status: 201 }))));
    const running = flushQueue();
    await vi.waitFor(() => expect(posted).toEqual(['p1']));
    const resumed = resumeAuthRequired('judge-a');
    // Release only once the resume has re-queued the parked record, so the
    // in-flight pass (which listed 'pending' before that) is still running.
    await vi.waitFor(async () => expect((await get('parked'))?.status).toBe('pending'));
    release();
    await Promise.all([running, resumed]);
    expect(posted).toEqual(['p1', 'p2']);
    expect(await get('parked')).toBeUndefined();
  });
});

describe('what a flush actually sends (M-1)', () => {
  it('POSTs the queued body with the CSRF token and credentials', async () => {
    const body: ResultInput = { outcome: 'player2_win', player1_game_wins: 1, player2_game_wins: 2, games_drawn: 0 };
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', body });
    await flushQueue();
    expect(requests).toHaveLength(1);
    const { init } = requests[0];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
  });

  it('fetches a fresh CSRF token after one is rejected', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    replies.set('p1', { status: 403, error: 'FST_CSRF_INVALID_TOKEN' });
    await flushQueue();
    replies.delete('p1');
    await flushQueue();
    expect(csrfFetches).toBe(2);
    expect((requests[1].init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-2');
    expect(await get('r1')).toBeUndefined();
  });
});

describe('offline and rejected results (M-2)', () => {
  it('stops the pass on a failed request and keeps everything queued', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', createdAt: 1 });
    await put({ id: 'r2', pairingId: 'p2', userId: 'judge-a', createdAt: 2 });
    await put({ id: 'r3', pairingId: 'p3', userId: 'judge-a', createdAt: 3 });
    replies.set('p1', 'throw');
    await flushQueue();
    expect(posted).toEqual(['p1']);
    for (const id of ['r1', 'r2', 'r3']) expect((await get(id))?.status).toBe('pending');
    expect(assign).not.toHaveBeenCalled();
  });

  it('marks a result the server already has as a conflict, with the neutral wording', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    replies.set('p1', { status: 409, error: 'RESULT_ALREADY_ENTERED' });
    await flushQueue();
    const record = await get('r1');
    expect(record?.status).toBe('conflict');
    expect(record?.failureReason).toBe(RESULT_ALREADY_RECORDED_MESSAGE);
  });

  it('keeps going after a rejected result — it says nothing about the rest', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', createdAt: 1 });
    await put({ id: 'r2', pairingId: 'p2', userId: 'judge-a', createdAt: 2 });
    replies.set('p1', { status: 422, error: 'BYE_RESULT' });
    await flushQueue();
    expect((await get('r1'))?.status).toBe('failed');
    expect(await get('r2')).toBeUndefined();
  });
});

describe('queue rules pinned (M-3)', () => {
  it('reclaims a dead tab only after the longest a live send can take', () => {
    // A live attempt: CSRF prime + POST, each bounded by its timeout. Any
    // shorter window would reclaim a send still in flight — the double-send
    // the window exists to prevent.
    expect(STALE_SYNCING_MS).toBeGreaterThan(CSRF_PRIME_TIMEOUT_MS + REQUEST_TIMEOUT_MS);
  });

  it('gives up on a CSRF-rejected result after exactly 3 rejections in a row', () => {
    expect(CSRF_FAILURE_LIMIT).toBe(3);
  });

  describe('stale boundary', () => {
    afterEach(() => vi.restoreAllMocks());
    const NOW = 10_000_000;

    it('leaves a claim exactly STALE_SYNCING_MS old alone', async () => {
      await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', status: 'syncing', syncingSince: NOW - STALE_SYNCING_MS });
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      await flushQueue();
      expect(posted).toEqual([]);
    });

    it('reclaims one a millisecond older', async () => {
      await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a', status: 'syncing', syncingSince: NOW - STALE_SYNCING_MS - 1 });
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      await flushQueue();
      expect(posted).toEqual(['p1']);
    });
  });

  it('counts only consecutive CSRF rejections — another failure resets the count', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    replies.set('p1', { status: 403, error: 'FST_CSRF_INVALID_TOKEN' });
    for (let i = 1; i < CSRF_FAILURE_LIMIT; i++) await flushQueue();
    replies.set('p1', 'throw');
    await flushQueue();
    replies.set('p1', { status: 403, error: 'FST_CSRF_INVALID_TOKEN' });
    for (let i = 1; i < CSRF_FAILURE_LIMIT; i++) await flushQueue();
    expect((await get('r1'))?.status).toBe('pending');
  });

  it('does not send a result if the session changes while the CSRF token is fetched', async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    onCsrfFetch = () => setSessionUserId('judge-b');
    await flushQueue();
    expect(posted).toEqual([]);
    expect((await get('r1'))?.status).toBe('pending');
  });

  it("writes no outcome over a claim another tab has since taken over", async () => {
    await put({ id: 'r1', pairingId: 'p1', userId: 'judge-a' });
    replies.set('p1', async () => {
      // Another tab reclaimed it (its own syncingSince) while this POST hung.
      const db = await openDb();
      const r1 = (await db.get('queuedResults', 'r1'))!;
      await db.put('queuedResults', { ...r1, status: 'syncing', syncingSince: 42 });
      return { status: 409, error: 'RESULT_ALREADY_ENTERED' };
    });
    await flushQueue();
    expect(await get('r1')).toMatchObject({ status: 'syncing', syncingSince: 42 });
  });

  it('re-entering a result replaces the queued one for that pairing', async () => {
    await enqueueResult(T, 'p1', BODY);
    const corrected: ResultInput = { outcome: 'draw', player1_game_wins: 1, player2_game_wins: 1, games_drawn: 1 };
    await enqueueResult(T, 'p1', corrected);
    const all = await (await openDb()).getAll('queuedResults');
    expect(all).toHaveLength(1);
    expect(all[0].body).toEqual(corrected);
  });
});

describe('records from before ownership existed (no userId)', () => {
  it('are still sent, under whoever is signed in', async () => {
    await put({ id: 'legacy', pairingId: 'p1' });
    await flushQueue();
    expect(posted).toEqual(['p1']);
  });

  it("aren't counted as the signing-out judge's own", async () => {
    await put({ id: 'legacy', pairingId: 'p1' });
    await put({ id: 'gone', pairingId: 'p2', userId: 'judge-a', status: 'conflict' });
    expect(await countUnsentForUser('judge-a')).toBe(0);
  });
});
