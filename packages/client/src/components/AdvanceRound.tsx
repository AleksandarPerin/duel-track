import { useEffect, useId, useRef, useState } from 'react';
import { advanceRound, AdvanceRoundResponse } from '../api/pairings';
import { ApiError } from '../api/client';

function advanceErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'RESULTS_INCOMPLETE':
      // The page's own count can lag (e.g. a judge's result still syncing
      // from their device) — the server's view is the one that counts.
      return 'The server still has results missing for this round. Refresh to see the latest, then try again.';
    case 'ROUND_NOT_ACTIVE':
      return 'This round is no longer the active one — it may have been closed in another tab. Refresh the page.';
    case 'TOURNAMENT_NOT_IN_PROGRESS':
      return 'This tournament is no longer in progress — it may have been completed in another tab. Refresh the page.';
    case 'TOURNAMENT_NOT_FOUND':
      return 'This tournament no longer exists.';
    case 'FORBIDDEN':
      return 'Only the tournament organizer can close a round.';
    case 'WINNER_NO_LONGER_ACTIVE':
      return 'A match winner has since been dropped, so the bracket can’t advance automatically. Resolve it before closing the round.';
    case 'INSUFFICIENT_PLAYERS_FOR_CUT':
      return 'Not enough active players remain to start the top cut.';
    case 'INVALID_ELIMINATION_RESULT':
      return 'An elimination match has a result with no winner. Correct it before closing the round.';
    case 'ELIMINATION_BRACKET_CORRUPT':
      // Deterministic — retrying fails the same way every time.
      return 'The bracket data for this round is inconsistent, so it can’t be advanced. This needs a manual fix — retrying won’t help.';
    default:
      return 'Failed to close the round. Please try again.';
  }
}

export function AdvanceRound({
  tournamentId,
  roundNumber,
  phase,
  missingResults,
  isOnline,
  onCheckResults,
  onAdvanced,
}: {
  tournamentId: string;
  roundNumber: number;
  phase: string;
  // Non-bye pairings with no server-confirmed result. Results still waiting
  // in the offline queue count as missing — the server doesn't have them.
  missingResults: number;
  isOnline: boolean;
  // Re-reads which pairings have results — judges enter them on their own
  // devices, and nothing pushes those to this page.
  onCheckResults: () => Promise<void>;
  onAdvanced: (result: AdvanceRoundResponse) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);
  const mounted = useRef(false);
  const questionId = useId();
  const reasonId = useId();

  // Set in the effect body (not just cleared in cleanup) so StrictMode's
  // dev-only unmount/remount leaves it true.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Toggling `confirming` swaps buttons, and the DOM drops focus to <body>
  // when the focused one unmounts — so move it explicitly, but only after a
  // toggle the user made (a "skip the first render" guard is defeated by
  // StrictMode's dev double-mount, and then steals focus on page load).
  function toggleConfirm(next: boolean) {
    focusAfterToggle.current = true;
    setConfirming(next);
  }

  useEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    (confirming ? confirmButtonRef : closeButtonRef).current?.focus();
  }, [confirming]);

  const blocked = missingResults > 0 || !isOnline;

  // When the last missing result arrives (a check or the poll), the Check
  // button and the reason text unmount; if focus was on them it falls to
  // <body>. Rescue only lost focus, and only on that transition — on a
  // fresh page load focus also sits on <body>, and landing a keyboard user
  // straight on a one-way action would skip the whole page.
  const prevMissing = useRef(missingResults);
  useEffect(() => {
    const cameIn = prevMissing.current > 0 && missingResults === 0;
    prevMissing.current = missingResults;
    if (cameIn && !confirming && document.activeElement === document.body) {
      closeButtonRef.current?.focus();
    }
  }, [missingResults, confirming]);

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    setError(null);
    try {
      const result = await advanceRound(tournamentId, roundNumber);
      // The user navigated away mid-request: don't yank them to the next
      // round from a page they already left.
      if (!mounted.current) return;
      // Not reset on success: the page navigates or reloads right away, so
      // staying "Closing…" avoids a flash of a re-enabled button.
      onAdvanced(result);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof ApiError ? advanceErrorMessage(err) : 'Failed to close the round. Please try again.');
      toggleConfirm(false);
      setAdvancing(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    try {
      await onCheckResults();
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  // Elimination rounds never write standings (only Swiss rounds do), so the
  // confirm must not promise any.
  const question =
    phase === 'elimination'
      ? `Close Round ${roundNumber}? Its results become final and the winners advance to the next bracket round — or, after the final, the tournament ends. This can't be undone.`
      : `Close Round ${roundNumber}? Its results become final, standings are calculated, and the next round is paired — after the last round, the top cut starts or the tournament ends. This can't be undone.`;

  return (
    <section className="advance-round" aria-label="Close this round">
      <div className="advance-round__actions">
        {confirming ? (
          <>
            <span id={questionId}>{question}</span>
            <button
              ref={confirmButtonRef}
              type="button"
              className="button button--primary"
              aria-describedby={blocked ? `${questionId} ${reasonId}` : questionId}
              disabled={advancing || blocked}
              onClick={handleAdvance}
            >
              {advancing ? 'Closing…' : 'Confirm'}
            </button>
            <button type="button" disabled={advancing} onClick={() => toggleConfirm(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              ref={closeButtonRef}
              type="button"
              className="button button--primary"
              aria-describedby={blocked ? reasonId : undefined}
              disabled={blocked}
              onClick={() => {
                setError(null);
                toggleConfirm(true);
              }}
            >
              Close Round {roundNumber}
            </button>
            {missingResults > 0 && isOnline && (
              <button type="button" disabled={checking} onClick={handleCheck}>
                {checking ? 'Checking…' : 'Check for new results'}
              </button>
            )}
          </>
        )}
      </div>
      {missingResults > 0 && (
        <p id={reasonId}>
          {missingResults === 1 ? '1 result is' : `${missingResults} results are`} still needed before this round can be
          closed. Results entered on other devices are picked up automatically about every 15 seconds.
        </p>
      )}
      {missingResults === 0 && !isOnline && <p id={reasonId}>You're offline — closing a round needs a connection.</p>}
      {/* Kept mounted with only its text changing, so the moment the last
          result arrives is announced (a status line that mounts already
          filled in usually isn't). */}
      <p role="status" className="advance-round__status">
        {missingResults === 0 && isOnline ? 'All results are in — this round can be closed.' : ''}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
