import type { ResultInput } from '@dueltrack/shared';
import { ensureCsrfToken } from '../api/client';
import { classifySyncAttempt } from './classify';
import { openDb, QueuedResult, QueuedResultStatus } from './db';

// UI listens for this to know when to re-read queue status — dispatched
// after any write to the queuedResults store (enqueue, or a flush pass).
export const QUEUE_UPDATED_EVENT = 'dueltrack:queue-updated';

export function notifyQueueUpdated(): void {
  window.dispatchEvent(new Event(QUEUE_UPDATED_EVENT));
}

// getAll + filter rather than a dedicated index: a single tournament's queue
// is small (bounded by its pairing count), so an index isn't worth the extra
// store complexity.
export interface QueuedStatusEntry {
  status: QueuedResultStatus;
  failureReason?: string; // present when status === 'failed' — e.g. distinguishes a conflict from a plain rejection
}

export async function getQueuedStatusForTournament(
  tournamentId: string,
): Promise<Map<string, QueuedStatusEntry>> {
  const db = await openDb();
  const all = await db.getAll('queuedResults');
  const byPairing = new Map<string, QueuedStatusEntry>();
  for (const record of all) {
    if (record.tournamentId === tournamentId) {
      byPairing.set(record.pairingId, { status: record.status, failureReason: record.failureReason });
    }
  }
  return byPairing;
}

// PURE — extracted so FIFO ordering is unit-testable without real IndexedDB
// I/O. Sorted oldest-first: results should land on the server in the order
// the judge actually entered them, for a sane audit-log/result history.
export function selectPendingInOrder<T extends { createdAt: number }>(records: T[]): T[] {
  return [...records].sort((a, b) => a.createdAt - b.createdAt);
}

// Deletes any existing queued record(s) for this pairing first, so a pairing
// never has more than one active queue entry — otherwise a stale 'failed'
// record from an earlier attempt would linger forever (getAll has no
// natural order to resolve which record "wins" in getQueuedStatusForTournament)
// even after the judge successfully re-enters the result.
// Does not dispatch QUEUE_UPDATED_EVENT itself — callers that use this as an
// internal step (e.g. enqueueResult) fire their own notify once the whole
// operation settles, so a listener never observes the transient
// deleted-but-not-yet-replaced state in between.
export async function discardQueuedForPairing(tournamentId: string, pairingId: string): Promise<void> {
  const db = await openDb();
  const all = await db.getAll('queuedResults');
  const stale = all.filter((r) => r.tournamentId === tournamentId && r.pairingId === pairingId);
  await Promise.all(stale.map((r) => db.delete('queuedResults', r.id)));
}

export async function enqueueResult(
  tournamentId: string,
  pairingId: string,
  body: ResultInput,
): Promise<void> {
  await discardQueuedForPairing(tournamentId, pairingId);
  const db = await openDb();
  const record: QueuedResult = {
    id: crypto.randomUUID(),
    tournamentId,
    pairingId,
    body,
    createdAt: Date.now(),
    status: 'pending',
  };
  await db.put('queuedResults', record);
  notifyQueueUpdated();
}

async function attemptSubmit(record: QueuedResult): Promise<{ threw: true } | { threw: false; status: number; errorCode?: string }> {
  try {
    // Awaits/retries priming rather than reading whatever's in memory — a
    // flush can run before the boot-time prime resolves, or after it failed
    // because the app booted offline. Inside this try: a failed prime (e.g.
    // network error) is a retryable connectivity problem like any other,
    // not a reason to let this record get stuck at 'syncing' forever by
    // throwing out of the runFlush loop uncaught.
    const csrfToken = await ensureCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;

    // Raw fetch, not apiRequest — apiRequest auto-redirects to /login on 401,
    // which would yank the judge off the round page mid-flush. Here a 401
    // needs to be classified and the *queue* decides what happens next.
    const res = await fetch(`/api/tournaments/${record.tournamentId}/pairings/${record.pairingId}/result`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(record.body),
    });
    if (res.ok) return { threw: false, status: res.status };
    const errorBody = await res.json().catch(() => ({}));
    return { threw: false, status: res.status, errorCode: errorBody.error };
  } catch {
    return { threw: true };
  }
}

// Re-entrancy guard: flaky venue Wi-Fi can flap online/offline/online fast
// enough to fire overlapping 'online' events, and without this a second
// flushQueue() could start reading 'pending' items before the first pass has
// finished marking them 'syncing' — both would then submit the same item.
// Concurrent callers instead await the one run already in flight.
let flushInFlight: Promise<void> | null = null;

export function flushQueue(): Promise<void> {
  if (!flushInFlight) {
    flushInFlight = runFlush().finally(() => {
      flushInFlight = null;
    });
  }
  return flushInFlight;
}

// Serial, not concurrent: processes exactly one queued result at a time,
// awaiting each before starting the next. This keeps server-side audit-log
// ordering sane (see selectPendingInOrder) and avoids slamming a connection
// that just came back from being flaky at a venue with many queued items.
async function runFlush(): Promise<void> {
  const db = await openDb();

  // A record can be found here at 'syncing' if the app was killed mid-flush
  // last time (OS backgrounding a PWA, browser crash, force-close) — the
  // in-memory flushInFlight guard only prevents overlap *within* a live tab,
  // it can't protect a record whose tab is simply gone. Since nothing else
  // ever queries 'syncing', such a record would otherwise never be retried
  // and would show "Syncing…" in the UI forever with no way to recover it.
  const stuckSyncing = await db.getAllFromIndex('queuedResults', 'by-status', 'syncing');
  await Promise.all(stuckSyncing.map((r) => db.put('queuedResults', { ...r, status: 'pending' })));
  if (stuckSyncing.length > 0) notifyQueueUpdated();

  const pending = await db.getAllFromIndex('queuedResults', 'by-status', 'pending');
  const ordered = selectPendingInOrder(pending);

  // Notified after every per-item state change (not just once at the end) so
  // a judge watching a large batch flush (e.g. after a long offline stretch)
  // sees live progress instead of a frozen pre-flush view until everything
  // finishes.
  for (const record of ordered) {
    await db.put('queuedResults', { ...record, status: 'syncing' });
    notifyQueueUpdated();

    const attempt = await attemptSubmit(record);
    const outcome = classifySyncAttempt(attempt);

    if (outcome.kind === 'success') {
      await db.delete('queuedResults', record.id);
      notifyQueueUpdated();
      continue;
    }

    if (outcome.kind === 'retry-later') {
      await db.put('queuedResults', { ...record, status: 'pending' });
      notifyQueueUpdated();
      // A thrown fetch almost always means we just went offline again (or
      // never came back online) — every remaining item would fail the same
      // way, so stop this pass rather than burning through the whole queue.
      // A 5xx (also 'retry-later') is rarer and left for the next flush too;
      // treating it the same keeps this branch simple and still safe (the
      // 'online' listener and next app boot will retry).
      break;
    }

    if (outcome.kind === 'auth-required') {
      await db.put('queuedResults', { ...record, status: 'auth-required' });
      notifyQueueUpdated();
      // Every other queued item will also 401 (same expired session) — stop
      // and send the judge to sign in, without discarding anything queued.
      // Carries ?redirect= back to the current round, same as apiRequest's
      // 401 handler — there's no in-app nav back to a round otherwise.
      const redirect = encodeURIComponent(window.location.pathname);
      window.location.assign(`/login?redirect=${redirect}`);
      break;
    }

    // This specific item is permanently unsyncable, but that says nothing
    // about the rest of the queue, so keep going.
    const status = outcome.kind === 'conflict' ? 'conflict' : 'failed';
    await db.put('queuedResults', { ...record, status, failureReason: outcome.reason });
    notifyQueueUpdated();
  }
}
