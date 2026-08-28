import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TournamentAssignmentView } from '@dueltrack/shared';
import { getMyAssignments } from '../api/profile';
import { startTournament } from '../api/pairings';
import { ApiError } from '../api/client';
import { AppHeader } from '../components/AppHeader';

const TOURNAMENT_STATUS_LABELS: Record<TournamentAssignmentView['tournament_status'], string> = {
  draft: 'Draft',
  registration: 'Registration open',
  in_progress: 'In progress',
  top_cut: 'Top cut',
  completed: 'Completed',
  archived: 'Archived',
};

const ROUND_STATUS_LABELS: Record<NonNullable<TournamentAssignmentView['current_round_status']>, string> = {
  pending: 'not started',
  active: 'in progress',
  completed: 'completed',
};

function startTournamentErrorMessage(code: string): string {
  switch (code) {
    case 'FORBIDDEN':
      return 'Only the tournament organizer can start it.';
    case 'TOURNAMENT_NOT_STARTABLE':
      return "This tournament can't be started right now — it may have already been started elsewhere. Refresh and try again.";
    case 'INSUFFICIENT_PLAYERS':
      return 'At least 8 active players are required to start the tournament.';
    case 'TOURNAMENT_NOT_FOUND':
      return 'This tournament no longer exists.';
    default:
      return 'Failed to start the tournament. Please try again.';
  }
}

function AssignmentRow({ assignment }: { assignment: TournamentAssignmentView }) {
  const { tournament_id, tournament_name, tournament_status, is_organizer, current_round_number, current_round_status } =
    assignment;
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const isFirstRender = useRef(true);

  // Toggling `confirming` unmounts one button and mounts another — the DOM
  // silently drops focus to <body> when that happens (no auto-carry-over),
  // stranding a keyboard user. Move focus explicitly, but skip the very
  // first render so mounting the row doesn't steal focus from the page.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    (confirming ? confirmButtonRef : startButtonRef).current?.focus();
  }, [confirming]);

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const result = await startTournament(tournament_id);
      navigate(`/t/${tournament_id}/r/${result.round.round_number}`);
    } catch (err) {
      // Not reset in a finally: on success we navigate away, so staying
      // "Starting…" until unmount avoids a flash of re-enabled UI.
      setStartError(err instanceof ApiError ? startTournamentErrorMessage(err.code) : 'Failed to start the tournament. Please try again.');
      setStarting(false);
    }
  }

  return (
    <li className="assignment-card">
      <div className="assignment-card__main">
        <span className="assignment-card__name">{tournament_name}</span>
        <span className={`badge ${is_organizer ? 'badge--organizer' : 'badge--judge'}`}>
          {is_organizer ? 'Organizer' : 'Judge'}
        </span>
      </div>
      <div className="assignment-card__meta">
        <span>{TOURNAMENT_STATUS_LABELS[tournament_status]}</span>
        {current_round_number != null && current_round_status != null ? (
          <Link className="button" to={`/t/${tournament_id}/r/${current_round_number}`}>
            Round {current_round_number} ({ROUND_STATUS_LABELS[current_round_status]}) →
          </Link>
        ) : is_organizer && (tournament_status === 'draft' || tournament_status === 'registration') ? (
          <div className="assignment-card__actions">
            {confirming ? (
              <>
                <span>Start Round 1 now? This locks in pairings and can't be undone.</span>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className="button button--primary"
                  disabled={starting}
                  onClick={handleStart}
                >
                  {starting ? 'Starting…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => {
                    setConfirming(false);
                    setStartError(null);
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  ref={startButtonRef}
                  type="button"
                  className="button button--primary"
                  onClick={() => setConfirming(true)}
                >
                  Start Tournament
                </button>
                {tournament_status === 'registration' && (
                  <Link className="button" to={`/t/${tournament_id}/registrations`}>
                    Manage signups →
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <span className="assignment-card__no-round">No rounds started yet</span>
        )}
      </div>
      {startError && <p role="alert">{startError}</p>}
    </li>
  );
}

export function DashboardPage() {
  const [assignments, setAssignments] = useState<TournamentAssignmentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyAssignments()
      .then((data) => {
        if (!cancelled) setAssignments(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.code : 'Failed to load your tournaments.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <AppHeader />
      <main className="page">
        <h1>Your Tournaments</h1>
        {error && <p role="alert">{error}</p>}
        {!error && !assignments && <p>Loading your tournaments…</p>}
        {assignments && assignments.length === 0 && (
          <p>You're not an organizer or judge for any tournament yet.</p>
        )}
        {assignments && assignments.length > 0 && (
          <ul className="assignment-list">
            {assignments.map((a) => (
              <AssignmentRow key={a.tournament_id} assignment={a} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
