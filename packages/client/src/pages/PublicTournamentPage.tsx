import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { TournamentExport, TournamentExportRound } from '@dueltrack/shared';
import { getTournamentExport } from '../api/publicTournament';
import { ApiError } from '../api/client';
import { RoundTimer } from '../components/RoundTimer';
import { formatPercent } from '../format';

function outcomeLabel(outcome: string, player1Name: string, player2Name: string): string {
  switch (outcome) {
    case 'player1_win':
      return `${player1Name} wins`;
    case 'player2_win':
      return `${player2Name} wins`;
    case 'draw':
      return 'Draw';
    case 'intentional_draw':
      return 'Intentional draw';
    case 'double_loss':
      return 'Double loss';
    default:
      return outcome;
  }
}

function latestRound(rounds: TournamentExportRound[]): TournamentExportRound | undefined {
  return rounds.find((r) => r.status === 'active') ?? rounds[rounds.length - 1];
}

// ?round=N (e.g. RoundPage's link right after publishing round N) picks the
// initial round; without it, or if N isn't in the export, falls back to the
// active/latest round — which, after closing round N, is already N+1.
function initialRound(rounds: TournamentExportRound[], requested: number | null): number | null {
  if (requested != null && rounds.some((r) => r.round_number === requested)) return requested;
  return latestRound(rounds)?.round_number ?? null;
}

export function PublicTournamentPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by links that know the export just changed (PublishStandings, right
  // after publishing) — not inferred from ?round, which the round picker now
  // keeps in the URL, so every reload of a shared link would otherwise skip
  // the short public cache and hit the origin.
  const revalidate = (useLocation().state as { revalidate?: boolean } | null)?.revalidate === true;
  const roundParam = searchParams.get('round');
  const requestedRound = roundParam && /^\d+$/.test(roundParam) ? Number(roundParam) : null;
  const [data, setData] = useState<TournamentExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    // Reset rather than carry over the previous load's state — a direct
    // navigation to another tournament (skipping a remount) would otherwise
    // keep the old round number, or keep showing an earlier failure's error
    // card over a now-successful refetch. ?round is read once here, for the
    // initial selection; later changes are handled by the effect below
    // without refetching.
    setData(null);
    setError(null);
    setSelectedRound(null);
    getTournamentExport(tournamentId, { revalidate })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setSelectedRound(initialRound(result.rounds, requestedRound));
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
    // requestedRound and revalidate are deliberately read only at fetch
    // time — refetching on every round pick would be wasteful (see the next
    // effect).
  }, [tournamentId]);

  // ?round changed while the page stays mounted (the round picker below,
  // back/forward, or a link to another round): select it from the data
  // already loaded.
  useEffect(() => {
    // data still from the previous tournament (in-app navigation between two
    // tournaments runs this before the new fetch clears it) — judging this
    // URL's ?round against the old rounds would wrongly strip it.
    if (!data || data.tournament.id.toLowerCase() !== tournamentId?.toLowerCase()) return;
    if (roundParam == null) {
      // ?round removed by navigation (back to the bare link): show the
      // active/latest round, same as a fresh load of that URL.
      setSelectedRound(latestRound(data.rounds)?.round_number ?? null);
      return;
    }
    if (requestedRound != null && data.rounds.some((r) => r.round_number === requestedRound)) {
      setSelectedRound(requestedRound);
      return;
    }
    // ?round names no round in this tournament (or isn't a number): the page
    // already fell back to the latest round, so drop the stale param rather
    // than leave a URL that claims a round it isn't showing.
    setSearchParams(
      (params) => {
        params.delete('round');
        return params;
      },
      { replace: true },
    );
  }, [data, tournamentId, requestedRound, roundParam, setSearchParams]);

  // Mirrors the picked round into the URL, so a reload or a copied link
  // opens the same round (replace: picking rounds isn't worth history
  // entries).
  function selectRound(roundNumber: number) {
    setSelectedRound(roundNumber);
    // Functional form keeps any other query params on the URL.
    setSearchParams(
      (params) => {
        params.set('round', String(roundNumber));
        return params;
      },
      { replace: true },
    );
  }

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
                onChange={(e) => selectRound(Number(e.target.value))}
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
                <RoundTimer status={round.status} startedAt={round.started_at} timerMinutes={round.timer_minutes} />
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
                              : p.result
                                ? outcomeLabel(p.result.outcome, p.player1_name, p.player2_name ?? '')
                                : 'Not yet reported'}
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
