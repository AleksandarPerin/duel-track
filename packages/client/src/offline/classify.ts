export type SyncOutcome =
  | { kind: 'success' }
  | { kind: 'retry-later' } // network failure or 5xx — keep queued, status stays 'pending'
  | { kind: 'auth-required' } // 401 — keep queued, status 'auth-required', redirect to /login
  | { kind: 'conflict'; reason: string } // RESULT_ALREADY_ENTERED (409) — status 'failed', surfaced distinctly
  | { kind: 'rejected'; reason: string }; // other 4xx — status 'failed', surfaced distinctly

export type SyncAttemptResult =
  | { threw: true }
  | { threw: false; status: number; errorCode?: string };

// PURE — no IndexedDB, no fetch. Every branch is unit tested exhaustively in
// classify.test.ts.
export function classifySyncAttempt(outcome: SyncAttemptResult): SyncOutcome {
  if (outcome.threw) return { kind: 'retry-later' };

  const { status, errorCode } = outcome;
  if (status >= 200 && status < 300) return { kind: 'success' };
  if (status === 401) return { kind: 'auth-required' };
  if (status === 409 && errorCode === 'RESULT_ALREADY_ENTERED') {
    return { kind: 'conflict', reason: 'Someone else already entered this result while you were offline.' };
  }
  if (status >= 400 && status < 500) {
    return { kind: 'rejected', reason: errorCode ?? 'Request was rejected' };
  }
  return { kind: 'retry-later' }; // 5xx — transient, keep retrying
}
