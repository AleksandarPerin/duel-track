import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TournamentAssignmentView } from '@dueltrack/shared';
import { getMyAssignments } from '../api/profile';
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

function AssignmentRow({ assignment }: { assignment: TournamentAssignmentView }) {
  const { tournament_id, tournament_name, tournament_status, is_organizer, current_round_number, current_round_status } =
    assignment;

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
        ) : (
          <span className="assignment-card__no-round">No rounds started yet</span>
        )}
      </div>
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
