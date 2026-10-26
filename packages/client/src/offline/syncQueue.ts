import type { ResultInput } from '@dueltrack/shared';
import { ensureCsrfToken, fetchWithTimeout, redirectToLogin, REQUEST_TIMEOUT_MS, resetCsrfToken } from '../api/client';
import { resultErrorMessage } from '../api/resultErrors';
import { getSessionUserId } from '../api/sessionUser';
import { classifySyncAttempt } from './classify';
import { openDb, QueuedResult, QueuedResultStatus } from './db';

// UI listens for this to know when to re-read queue status — dispatched
// after any write to the queuedResults store (enqueue, or a flush pass).
export const QUEUE_UPDATED_EVENT = 'dueltrack:queue-updated';

export function notifyQueueUpdated(): void {
  window.dispatchEvent(new Event(QUEUE_UPDATED_EVENT));
}

// A 'syncing' record older than this belongs to a tab that died mid-send
// (OS backgrounding a PWA, crash, force-close) and may be reclaimed. Younger
// ones may still be in flight in another tab — reclaiming those sent the
// same result twice and let the loser's 409 re-create a record the winner
// had already deleted. Covers the longest a live attempt can take: a CSRF
// prime (10s) plus the POST (REQUEST_TIMEOUT_MS), with margin.
export const STALE_SYNCING_MS = 10_000 + REQUEST_TIMEOUT_MS + 15_000;

// A CSRF rejection is normally cleared by re-priming the token, so it's
// retried — but one that never clears (e.g. the _csrf cookie is blocked)
// would otherwise block the queue forever behind a "Queued" label. After
// this many in a row the record is marked failed, with a visible reason.
export const CSRF_FAILURE_LIMIT = 3;

// Legacy records (no userId) keep the pre-ownership behaviour and go out
// under whichever session is current; owned ones only under their owner's.
function isSendableBy(record: QueuedResult, userId: string | null): boolean {
  return record.userId === undefined || record.userId === userId;
}

// getAll + filter rather than a dedicated index: a single tournament's queue
// is small (bounded by its pairing count), so an index isn't worth the extra
// store complexity.
export interface QueuedStatusEntry {
  status: QueuedResultStatus;
  failureReason?: string; // present when status === 'failed' — e.g. distinguishes a conflict from a plain rejection
  // Queued by a different user on this device: it won't be sent until they
  // sign in here again, so the UI says so and offers re-entry.
  otherUser: boolean;
}

export async function getQueuedStatusForTournament(
  tournamentId: string,
): Promise<Map<string, QueuedStatusEntry>> {
  const db = await openDb();
  const all = await db.getAll('queuedResults');
  const userId = getSessionUserId();
  const byPairing = new Map<string, QueuedStatusEntry>();
  for (const record of all) {
    if (record.tournamentId === tournamentId) {
      byPairing.set(record.pairingId, {
        status: record.status,
        failureReason: record.failureReason,
        otherUser: !isSendableBy(record, userId),
      });
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
  // 'auth-required' parks it until the next successful sign-in (see
  // resumeAuthRequired) instead of letting a flush 401 and redirect again.
  status: 'pending' | 'auth-required' = 'pending',
): Promise<void> {
  await discardQueuedForPairing(tournamentId, pairingId);
  const db = await openDb();
  const record: QueuedResult = {
    id: crypto.randomUUID(),
    tournamentId,
    pairingId,
    body,
    createdAt: Date.now(),
    status,
    userId: getSessionUserId() ?? undefined,
  };
  await db.put('queuedResults', record);
  notifyQueueUpdated();
}

// Read-modify-write of one record in a single readwrite transaction. These
// are serialized across tabs, so a change decided from the record's current
// state can't be undone by another tab's write in between. `change` returns
// the new record, 'delete', or null to leave it be; a record that no longer
// exists is left alone (never re-created). Resolves to whether it wrote.
async function updateRecord(
  id: string,
  change: (current: QueuedResult) => QueuedResult | 'delete' | null,
): Promise<boolean> {
  const db = await openDb();
  const tx = db.transaction('queuedResults', 'readwrite');
  const current = await tx.store.get(id);
  const next = current ? change(current) : null;
  if (next === 'delete') await tx.store.delete(id);
  else if (next) await tx.store.put(next);
  await tx.done;
  return next !== null;
}

// Moves the signed-in user's 'pending' results to 'auth-required' in one
// go: once one 401s, every other one would too (same expired session), and
// leaving them 'pending' meant each later flush 401'd and redirected again —
// once per record, even while the judge was on the login page.
export async function parkPendingForSignIn(): Promise<void> {
  const db = await openDb();
  const userId = getSessionUserId();
  const pending = await db.getAllFromIndex('queuedResults', 'by-status', 'pending');
  let parked = false;
  for (const listed of pending.filter((r) => isSendableBy(r, userId))) {
    const wrote = await updateRecord(listed.id, (cur) => (cur.status === 'pending' ? { ...cur, status: 'auth-required' } : null));
    parked ||= wrote;
  }
  if (parked) notifyQueueUpdated();
}

// How many of this user's results are still only on this device. Checked
// at sign-out: their results are only ever sent under their own session, so
// once they sign out these wait until they sign in here again — the login
// page says so. Results the server rejected ('failed'/'conflict') aren't
// counted — the round page shows them with their reason and a form — except
// CSRF give-ups, which the server never judged and which resumeAuthRequired
// retries. Legacy unowned records aren't either: they aren't waiting for
// this user — see isSendableBy.
export async function countUnsentForUser(userId: string): Promise<number> {
  const db = await openDb();
  const all = await db.getAll('queuedResults');
  return all.filter(
    (r) =>
      r.userId === userId &&
      (r.status === 'pending' || r.status === 'syncing' || r.status === 'auth-required' || isCsrfGiveUp(r)),
  ).length;
}

// Marked 'failed' only because CSRF kept rejecting it (see
// CSRF_FAILURE_LIMIT) — a valid result the server never judged. A fresh
// sign-in brings a fresh token, so these get another go then.
function isCsrfGiveUp(r: QueuedResult): boolean {
  return r.status === 'failed' && (r.csrfFailures ?? 0) >= CSRF_FAILURE_LIMIT;
}

async function attemptSubmit(
  record: QueuedResult,
  // Re-checked right before the POST (after the CSRF prime, which can take
  // seconds): the request goes out with whatever session cookie is current
  // at that moment, which must still be the one this pass is sending for.
  sessionUnchanged: () => boolean,
): Promise<{ skipped: true } | { threw: true } | { threw: false; status: number; errorCode?: string }> {
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
    if (!sessionUnchanged()) return { skipped: true };

    // Raw fetch, not apiRequest — apiRequest auto-redirects to /login on 401,
    // which would yank the judge off the round page mid-flush. Here a 401
    // needs to be classified and the *queue* decides what happens next.
    const res = await fetchWithTimeout(`/api/tournaments/${record.tournamentId}/pairings/${record.pairingId}/result`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(record.body),
    });
    if (res.ok) return { threw: false, status: res.status };
    const errorBody = await res.json().catch(() => ({}));
    // classify treats this as retry-later; drop the rejected token so the
    // next attempt primes a fresh one instead of failing the same way.
    if (res.status === 403 && String(errorBody.error ?? '').startsWith('FST_CSRF')) resetCsrfToken();
    return { threw: false, status: res.status, errorCode: errorBody.error };
  } catch {
    return { threw: true };
  }
}

// Re-entrancy guard: flaky venue Wi-Fi can flap online/offline/online fast
// enough to fire overlapping 'online' events, and without this a second
// flushQueue() could start reading 'pending' items before the first pass has
// finished marking them 'syncing' — both would then submit the same item.
// Concurrent callers instead await the one run already in flight. (Only
// within one tab — across tabs, the per-record claim in runFlush applies.)
let flushInFlight: Promise<void> | null = null;

// Results parked as 'auth-required' (a 401 sent the judge to sign in) wait
// for that same judge to sign in again: only theirs are resumed, so on a
// shared venue phone the next person's session never sends (and gets
// audit-logged for) someone else's results. Called after a successful
// sign-in only — doing it on every flush would 401 again and bounce a
// still-signed-out user to /login in a loop.
export async function resumeAuthRequired(userId: string): Promise<void> {
  const db = await openDb();
  const parked = [
    ...(await db.getAllFromIndex('queuedResults', 'by-status', 'auth-required')),
    ...(await db.getAllFromIndex('queuedResults', 'by-status', 'failed')).filter(isCsrfGiveUp),
  ];
  let resumed = false;
  for (const listed of parked.filter((r) => isSendableBy(r, userId))) {
    const wrote = await updateRecord(listed.id, (cur) =>
      cur.status === 'auth-required' || isCsrfGiveUp(cur)
        ? { ...cur, status: 'pending', csrfFailures: undefined, failureReason: undefined }
        : null,
    );
    resumed ||= wrote;
  }
  if (resumed) notifyQueueUpdated();
  // A pass already running listed 'pending' before these were moved back,
  // so it won't send them — let it finish, then start a fresh one rather
  // than leaving them for the next 30s tick.
  if (flushInFlight) await flushInFlight.catch(() => {});
  await flushQueue();
}

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
  const userId = getSessionUserId();

  // A record can be found here at 'syncing' if the app was killed mid-flush
  // last time — since nothing else ever queries 'syncing', such a record
  // would otherwise never be retried and would show "Syncing…" in the UI
  // forever. Only stale ones, though (see STALE_SYNCING_MS): a recent one is
  // most likely being sent by another open tab right now. No syncingSince
  // means it was claimed by an older version of the app — treat as stale.
  const now = Date.now();
  const syncing = await db.getAllFromIndex('queuedResults', 'by-status', 'syncing');
  const isStale = (r: QueuedResult) => r.syncingSince === undefined || now - r.syncingSince > STALE_SYNCING_MS;
  let reclaimed = false;
  for (const listed of syncing.filter(isStale)) {
    const wrote = await updateRecord(listed.id, (cur) =>
      cur.status === 'syncing' && isStale(cur) ? { ...cur, status: 'pending', syncingSince: undefined } : null,
    );
    reclaimed ||= wrote;
  }
  if (reclaimed) notifyQueueUpdated();

  const pending = await db.getAllFromIndex('queuedResults', 'by-status', 'pending');
  const ordered = selectPendingInOrder(pending.filter((r) => isSendableBy(r, userId)));

  // Notified after every per-item state change (not just once at the end) so
  // a judge watching a large batch flush (e.g. after a long offline stretch)
  // sees live progress instead of a frozen pre-flush view until everything
  // finishes.
  // The session can change while this pass runs — sign-out stops waiting
  // for it after a few seconds, and someone else may sign in. The list was
  // filtered for the user signed in at the start, so stop as soon as that
  // no longer holds: the next POST would carry the new person's cookie.
  const sessionUnchanged = () => getSessionUserId() === userId;
  for (const listed of ordered) {
    if (!sessionUnchanged()) break;
    // Claim it: 'pending' → 'syncing' only if it's still 'pending' now —
    // another tab may have claimed (or the judge re-entered) it since this
    // pass listed it.
    const claimedAt = Date.now();
    let record: QueuedResult | undefined;
    await updateRecord(listed.id, (cur) =>
      cur.status === 'pending' ? (record = { ...cur, status: 'syncing', syncingSince: claimedAt }) : null,
    );
    if (!record) continue;
    notifyQueueUpdated();

    const attempt = await attemptSubmit(record, sessionUnchanged);
    // Write the outcome only while this pass still holds the claim: the
    // record may have been deleted meanwhile (another tab's send of it
    // succeeded), replaced by a re-entry, or reclaimed as stale.
    const settle = (next: (cur: QueuedResult) => QueuedResult) =>
      updateRecord(record!.id, (cur) =>
        cur.status === 'syncing' && cur.syncingSince === claimedAt ? next({ ...cur, syncingSince: undefined }) : null,
      );

    if ('skipped' in attempt) {
      // Session changed before it was sent: hand it back, untouched.
      await settle((cur) => ({ ...cur, status: 'pending' }));
      notifyQueueUpdated();
      break;
    }
    const outcome = classifySyncAttempt(attempt);

    if (outcome.kind === 'success') {
      // Unconditional: the result is on the server, whoever else holds it.
      await updateRecord(record.id, () => 'delete');
      notifyQueueUpdated();
      continue;
    }

    if (outcome.kind === 'retry-later') {
      const csrfRejected = !attempt.threw && attempt.status === 403 && !!attempt.errorCode?.startsWith('FST_CSRF');
      let gaveUp = false;
      await settle((cur) => {
        const csrfFailures = csrfRejected ? (cur.csrfFailures ?? 0) + 1 : undefined;
        if (csrfFailures !== undefined && csrfFailures >= CSRF_FAILURE_LIMIT) {
          gaveUp = true;
          // csrfFailures kept: marks this as a CSRF give-up (isCsrfGiveUp).
          return { ...cur, status: 'failed', failureReason: resultErrorMessage(attempt.threw ? undefined : attempt.errorCode, 403), csrfFailures };
        }
        return { ...cur, status: 'pending', csrfFailures };
      });
      notifyQueueUpdated();
      // Given up on: says nothing about the rest, and the token was reset.
      if (gaveUp) continue;
      // A thrown fetch almost always means we just went offline again (or
      // never came back online) — every remaining item would fail the same
      // way, so stop this pass rather than burning through the whole queue.
      // A 5xx (also 'retry-later') is rarer and left for the next flush too;
      // treating it the same keeps this branch simple and still safe (the
      // 'online' listener and next app boot will retry).
      break;
    }

    if (outcome.kind === 'auth-required') {
      await settle((cur) => ({ ...cur, status: 'auth-required' }));
      // Every other queued item will also 401 (same expired session) — park
      // them all and send the judge to sign in once, without discarding
      // anything queued.
      await parkPendingForSignIn();
      notifyQueueUpdated();
      redirectToLogin();
      break;
    }

    // This specific item is permanently unsyncable, but that says nothing
    // about the rest of the queue, so keep going.
    const status = outcome.kind === 'conflict' ? 'conflict' : 'failed';
    await settle((cur) => ({ ...cur, status, failureReason: outcome.reason }));
    notifyQueueUpdated();
  }
}
