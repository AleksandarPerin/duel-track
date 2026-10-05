import { FormEvent, useMemo, useState } from 'react';
import type { Pairing, ResultInput } from '@dueltrack/shared';
import { submitResult } from '../api/results';
import { ApiError } from '../api/client';
import {
  discardQueuedForPairing,
  enqueueResult,
  notifyQueueUpdated,
  QueuedStatusEntry,
} from '../offline/syncQueue';

// Every legal final score for a Bo3 match, exactly matching the DB's
// valid_game_total CHECK constraint (results.ts migration) — one option per
// row, so a judge picks the literal score they saw at the table instead of
// an abstract outcome plus a separate "loser's games" count (the two-step
// version read as confusing: a bare "0 games" / "1 game" dropdown never
// stated the winner's own score, or which player it was counting). Labels
// use the actual player names rather than "Player 1"/"Player 2" — a judge
// glancing at a generic label after tapping through a form has no easy way
// to tell which physical player "1" refers to.
function buildScoreOptions(player1Name: string, player2Name: string): { key: string; label: string; input: ResultInput }[] {
  return [
    { key: 'p1-2-0', label: `${player1Name} wins 2–0`, input: { outcome: 'player1_win', player1_game_wins: 2, player2_game_wins: 0, games_drawn: 0 } },
    { key: 'p1-2-1', label: `${player1Name} wins 2–1`, input: { outcome: 'player1_win', player1_game_wins: 2, player2_game_wins: 1, games_drawn: 0 } },
    { key: 'p2-2-0', label: `${player2Name} wins 2–0`, input: { outcome: 'player2_win', player1_game_wins: 0, player2_game_wins: 2, games_drawn: 0 } },
    { key: 'p2-2-1', label: `${player2Name} wins 2–1`, input: { outcome: 'player2_win', player1_game_wins: 1, player2_game_wins: 2, games_drawn: 0 } },
    { key: 'draw', label: 'Draw (1–1)', input: { outcome: 'draw', player1_game_wins: 1, player2_game_wins: 1, games_drawn: 1 } },
    { key: 'intentional_draw', label: 'Intentional draw', input: { outcome: 'intentional_draw', player1_game_wins: 0, player2_game_wins: 0, games_drawn: 0 } },
    { key: 'double_loss', label: 'Double loss', input: { outcome: 'double_loss', player1_game_wins: 0, player2_game_wins: 0, games_drawn: 0 } },
  ];
}

function ResultForm({
  tournamentId,
  pairing,
  player1Name,
  player2Name,
  onSubmitted,
}: {
  tournamentId: string;
  pairing: Pairing;
  player1Name: string;
  player2Name: string;
  onSubmitted: () => void;
}) {
  const scoreOptions = useMemo(() => buildScoreOptions(player1Name, player2Name), [player1Name, player2Name]);
  const [scoreKey, setScoreKey] = useState(scoreOptions[0].key);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    const body = scoreOptions.find((o) => o.key === scoreKey)!.input;

    // Offline entirely: skip the network attempt and queue immediately —
    // trying first would just cost a timeout for a result that's going in
    // the queue either way.
    if (!navigator.onLine) {
      await enqueueResult(tournamentId, pairing.id, body);
      setFeedback({ kind: 'ok', message: "Offline — result queued, will sync when you're back online." });
      setSubmitting(false);
      return;
    }

    // Clears a stale 'failed'/'conflict' queue entry (see
    // discardQueuedForPairing) when a pairing turns out to already be
    // recorded server-side, so a leftover queue record doesn't linger.
    async function markRecorded() {
      setFeedback({ kind: 'ok', message: 'Result recorded.' });
      await discardQueuedForPairing(tournamentId, pairing.id);
      notifyQueueUpdated();
      onSubmitted();
    }

    try {
      await submitResult(tournamentId, pairing.id, body);
      await markRecorded();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'RESULT_ALREADY_ENTERED') {
          // Already recorded — most likely by this same judge in an earlier
          // session (see the has_result seeding in RoundPage); treat it as success
          // rather than surfacing a confusing raw error.
          await markRecorded();
        } else {
          setFeedback({ kind: 'error', message: `${err.code}: ${String((err.details as { message?: string })?.message ?? '')}`.trim() });
        }
      } else {
        // navigator.onLine said we were online but the request still threw —
        // e.g. connection dropped mid-request. Queue rather than lose the
        // result the judge just entered.
        await enqueueResult(tournamentId, pairing.id, body);
        setFeedback({ kind: 'ok', message: 'Connection lost — result queued, will sync when back online.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <select
        aria-label={`Result for table ${pairing.table_number}`}
        value={scoreKey}
        onChange={(e) => setScoreKey(e.target.value)}
      >
        {scoreOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit result'}
      </button>
      {feedback && <span role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</span>}
    </form>
  );
}

export function renderResultCell({
  tournamentId,
  pairing,
  player1Name,
  player2Name,
  entered,
  queuedStatus,
  onSubmitted,
}: {
  tournamentId: string;
  pairing: Pairing;
  player1Name: string;
  player2Name: string;
  entered: boolean;
  queuedStatus: QueuedStatusEntry | undefined;
  onSubmitted: () => void;
}) {
  if (entered) return 'Recorded';

  if (queuedStatus) {
    switch (queuedStatus.status) {
      case 'pending':
        return 'Queued — will sync';
      case 'syncing':
        return 'Syncing…';
      case 'auth-required':
        return 'Queued — sign in to sync';
      case 'conflict':
        // Someone else already recorded this result server-side while the
        // judge was offline — re-entering would just 409 again, so no form.
        return <p role="alert">{queuedStatus.failureReason ?? 'Already recorded by someone else.'}</p>;
      case 'failed':
        // Any other rejection (e.g. a validation error) is not terminal:
        // showing the form below the reason lets the judge correct and
        // re-enter it.
        return (
          <>
            <p role="alert">{queuedStatus.failureReason ?? 'Sync failed.'}</p>
            <ResultForm
              tournamentId={tournamentId}
              pairing={pairing}
              player1Name={player1Name}
              player2Name={player2Name}
              onSubmitted={onSubmitted}
            />
          </>
        );
    }
  }

  return (
    <ResultForm
      tournamentId={tournamentId}
      pairing={pairing}
      player1Name={player1Name}
      player2Name={player2Name}
      onSubmitted={onSubmitted}
    />
  );
}
