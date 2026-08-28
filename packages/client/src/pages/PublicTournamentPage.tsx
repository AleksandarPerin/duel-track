import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { TournamentExport, TournamentExportRound } from '@dueltrack/shared';
import { getTournamentExport } from '../api/publicTournament';
import { ApiError } from '../api/client';

const OUTCOME_LABELS: Record<string, string> = {
  player1_win: 'Player 1 wins',
  player2_win: 'Player 2 wins',
  draw: 'Draw',
  intentional_draw: 'Intentional draw',
  double_loss: 'Double loss',
};

// Raw stored fraction (e.g. "0.5500") — the server never scales this to a
// percent before sending it (see TournamentExportStanding's own comment).
function formatPercent(v: string | null): string {
  return v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—';
}

function latestRound(rounds: TournamentExportRound[]): TournamentExportRound | undefined {
  return rounds.find((r) => r.status === 'active') ?? rounds[rounds.length - 1];
}

export function PublicTournamentPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [data, setData] = useState<TournamentExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    // Reset rather than carry over a previous tournament's selected round —
    // the effect only depends on tournamentId, so without this a direct
    // navigation between two public tournament pages (skipping a remount)
    // would keep showing the old tournament's round number.
    setData(null);
    setSelectedRound(null);
    getTournamentExport(tournamentId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setSelectedRound(latestRound(result.rounds)?.round_number ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 404
            ? "This tournament doesn't exist, or hasn't started yet."
            : 'Failed to load the tournament.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  const round = useMemo(
    () => data?.rounds.find((r) => r.round_number === selectedRound),
    [data, selectedRound],
  );

  if (error) {
    return (
      <main className="page page--centered">
        <div className="auth-card">
          <h1>DuelTrack</h1>
          <p role="alert">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page page--centered">
        <div className="auth-card">
          <h1>DuelTrack</h1>
          <p>Loading tournament…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>{data.tournament.name}</h1>
      <p className="auth-card__subtitle">
        {data.tournament.format} · {data.tournament.rel_level}
        {data.tournament.venue ? ` · ${data.tournament.venue}` : ''}
      </p>

      {data.rounds.length === 0 && <p>This tournament hasn't started its first round yet.</p>}

      {data.rounds.length > 0 && (
        <>
          {data.rounds.length > 1 && (
            <label htmlFor="roundSelect">
              Round
              <select
                id="roundSelect"
                value={selectedRound ?? ''}
                onChange={(e) => setSelectedRound(Number(e.target.value))}
              >
                {data.rounds.map((r) => (
                  <option key={r.round_number} value={r.round_number}>
                    Round {r.round_number} ({r.status})
                  </option>
                ))}
              </select>
            </label>
          )}

          {round && (
            <>
              <section>
                <h2>
                  Round {round.round_number} — {round.phase} ({round.status})
                </h2>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Table</th>
                        <th>Player 1</th>
                        <th>Player 2</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {round.pairings.map((p) => (
                        <tr key={p.id}>
                          <td>{p.table_number}</td>
                          <td>{p.player1_name}</td>
                          <td>{p.is_bye ? 'BYE' : p.player2_name}</td>
                          <td>
                            {p.is_bye
                              ? '—'
                              : (p.result && OUTCOME_LABELS[p.result.outcome]) ?? 'Not yet reported'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2>Standings</h2>
                {round.standings.length === 0 && <p>Standings haven't been published for this round yet.</p>}
                {round.standings.length > 0 && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Player</th>
                          <th>Points</th>
                          <th>W-L-D</th>
                          <th>OMW%</th>
                          <th>GW%</th>
                          <th>OGW%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {round.standings.map((s) => (
                          <tr key={s.player_id}>
                            <td>{s.rank}</td>
                            <td>{s.display_name}</td>
                            <td>{s.match_points}</td>
                            <td>
                              {s.match_wins}-{s.match_losses}-{s.match_draws}
                            </td>
                            <td>{formatPercent(s.omw_percent)}</td>
                            <td>{formatPercent(s.gw_percent)}</td>
                            <td>{formatPercent(s.ogw_percent)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
