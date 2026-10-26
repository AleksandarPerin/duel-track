// One place for what a failed result submission means to a judge — used by
// the live form (ResultEntry) and by the offline queue's 'failed' state
// (classify.ts), which previously showed raw codes like "PAIRING_NOT_FOUND".
// The server's error body is { error, message }; apiRequest keeps only
// body.details, so the code (plus HTTP status) is all callers have.
export function resultErrorMessage(code: string | undefined, status?: number): string {
  if (status === 429) return 'Too many submissions in a short time — wait a minute, then try again.';
  if (code?.startsWith('FST_CSRF')) return 'Your session’s security token expired — refresh the page, then try again.';
  switch (code) {
    case 'PAIRING_NOT_FOUND':
      return 'This round is no longer open for results — it may have been closed. Refresh the page.';
    case 'TOURNAMENT_NOT_IN_PROGRESS':
      return 'This tournament is no longer in progress.';
    case 'FORBIDDEN':
      return "You can't enter this result — only the organizer or an assigned judge can, and a judge can't enter their own match.";
    case 'BYE_RESULT':
      return 'A bye has no result to enter.';
    case 'INVALID_ELIMINATION_RESULT':
      return 'Elimination matches need a winner — draws and double losses aren’t allowed.';
    case 'INVALID_BODY':
    case 'INVALID_PARAMS':
      return 'That result was rejected as invalid. Refresh the page and try again.';
    default:
      return 'Failed to record the result. Please try again.';
  }
}

// A 409 RESULT_ALREADY_ENTERED most often means this judge's own earlier
// submission did reach the server (its response was lost or timed out), not
// that someone else got there first — so don't accuse anyone.
export const RESULT_ALREADY_RECORDED_MESSAGE =
  'A result was already recorded for this match — check that it matches what you entered.';
