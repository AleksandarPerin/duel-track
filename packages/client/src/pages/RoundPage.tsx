import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Pairing, ResultInput, ResultOutcome, Standing, TournamentPlayerView } from '@dueltrack/shared';
import { getPlayers } from '../api/tournaments';
import { getPairings, PairingsResponse } from '../api/pairings';
import { getStandings } from '../api/standings';
import { submitResult } from '../api/results';
import { ApiError } from '../api/client';
import { getCachedPlayers, getCachedStandings, setCachedPlayers, setCachedStandings } from '../offline/standingsCache';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  discardQueuedForPairing,
  enqueueResult,
  getQueuedStatusForTournament,
  notifyQueueUpdated,
  QUEUE_UPDATED_EVENT,
  QueuedStatusEntry,
} from '../offline/syncQueue';
import { AppHeader } from '../components/AppHeader';

interface CacheFallback<T> {
  data: T;
  fromCache: boolean;
  fetchedAt?: number;
}

// Always tries the network first; falls back to the IndexedDB cache only on a
// genuine failure (thrown error, or we already know we're offline) — never
// blends live and cached data silently, so RoundPage can show a banner
// whenever fromCache is true.
async function loadPlayersWithFallback(tournamentId: string): Promise<CacheFallback<TournamentPlayerView[]>> {
  if (navigator.onLine) {
    try {
      const data = await getPlayers(tournamentId);
      await setCachedPlayers(tournamentId, data);
      return { data, fromCache: false };
    } catch {
      // fall through to cache below
    }
  }
  const cached = await getCachedPlayers(tournamentId);
  if (cached) return { data: cached.data, fromCache: true, fetchedAt: cached.fetchedAt };
  throw new ApiError(0, 'PLAYERS_UNAVAILABLE');
}

async function loadStandingsWithFallback(
  tournamentId: string,
  roundNum: number,
): Promise<CacheFallback<Standing[]>> {
  if (navigator.onLine) {
    try {
      const data = await getStandings(tournamentId, roundNum);
      await setCachedStandings(tournamentId, roundNum, data);
      return { data, fromCache: false };
    } catch (err) {
      // STANDINGS_NOT_FOUND is the normal state for a round that hasn't
      // closed yet — a real empty state, not a failure to fall back from.
      if (err instanceof ApiError && err.status === 404) return { data: [], fromCache: false };
      // any other failure (network error, 5xx) falls through to cache below
    }
  }
  const cached = await getCachedStandings(tournamentId, roundNum);
  if (cached) return { data: cached.data, fromCache: true, fetchedAt: cached.fetchedAt };
  return { data: [], fromCache: false };
}

function formatRelativeTime(fetchedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - fetchedAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  return `${minutes} minutes ago`;
}

const OUTCOME_LABELS: Record<ResultOutcome, string> = {
  player1_win: 'Player 1 wins',
  player2_win: 'Player 2 wins',
  draw: 'Draw',
  intentional_draw: 'Intentional draw',
  double_loss: 'Double loss',
};

// Mirrors result.routes.ts's ResultInputSchema.superRefine — client-side only,
// for immediate feedback. The server stays authoritative; this never replaces
// its validation.
function defaultInputFor(outcome: ResultOutcome, prevP2OrP1 = 0): ResultInput {
  switch (outcome) {
    case 'intentional_draw':
    case 'double_loss':
      return { outcome, player1_game_wins: 0, player2_game_wins: 0, games_drawn: 0 };
    case 'player1_win':
      return { outcome, player1_game_wins: 2, player2_game_wins: prevP2OrP1, games_drawn: 0 };
    case 'player2_win':
      return { outcome, player1_game_wins: prevP2OrP1, player2_game_wins: 2, games_drawn: 0 };
    case 'draw':
      return { outcome, player1_game_wins: 1, player2_game_wins: 1, games_drawn: 1 };
  }
}

function ResultForm({
  tournamentId,
  pairing,
  onSubmitted,
}: {
  tournamentId: string;
  pairing: Pairing;
  onSubmitted: () => void;
}) {
  const [outcome, setOutcome] = useState<ResultOutcome>('player1_win');
  const [loserGames, setLoserGames] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const showLoserGamesInput = outcome === 'player1_win' || outcome === 'player2_win';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    const body = defaultInputFor(outcome, loserGames);

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
          // session (see the has_result seeding above); treat it as success
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
        aria-label={`Outcome for table ${pairing.table_number}`}
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as ResultOutcome)}
      >
        {(Object.keys(OUTCOME_LABELS) as ResultOutcome[]).map((o) => (
          <option key={o} value={o}>
            {OUTCOME_LABELS[o]}
          </option>
        ))}
      </select>
      {showLoserGamesInput && (
        <select
          aria-label="Loser's game wins"
          value={loserGames}
          onChange={(e) => setLoserGames(Number(e.target.value))}
        >
          <option value={0}>0 games</option>
          <option value={1}>1 game</option>
        </select>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit result'}
      </button>
      {feedback && <span role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</span>}
    </form>
  );
}

function renderResultCell({
  tournamentId,
  pairing,
  entered,
  queuedStatus,
  onSubmitted,
}: {
  tournamentId: string;
  pairing: Pairing;
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
            <ResultForm tournamentId={tournamentId} pairing={pairing} onSubmitted={onSubmitted} />
          </>
        );
    }
  }

  return <ResultForm tournamentId={tournamentId} pairing={pairing} onSubmitted={onSubmitted} />;
}

export function RoundPage() {
  const { tournamentId, roundNumber } = useParams<{ tournamentId: string; roundNumber: string }>();
  const roundNum = Number(roundNumber);
  const isOnline = useOnlineStatus();

  const [playersById, setPlayersById] = useState<Map<string, string>>(new Map());
  const [pairingsData, setPairingsData] = useState<PairingsResponse | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enteredPairingIds, setEnteredPairingIds] = useState<Set<string>>(new Set());
  const [cacheBanner, setCacheBanner] = useState<string | null>(null);
  const [queuedStatus, setQueuedStatus] = useState<Map<string, QueuedStatusEntry>>(new Map());
  const queuedStatusRef = useRef<Map<string, QueuedStatusEntry>>(new Map());

  // Reflects results queued while offline (including ones queued on a prior
  // visit, before this page ever loaded) and keeps that view live as
  // flushQueue() drains the queue in the background.
  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    const refresh = () => {
      getQueuedStatusForTournament(tournamentId).then((status) => {
        if (cancelled) return;
        // A pairing that was queued before this refresh but isn't anymore
        // was deleted by flushQueue() after a successful sync (the only path
        // that deletes rather than updating status) — reflect it as entered
        // rather than falling through to showing the entry form again.
        const resolved = [...queuedStatusRef.current.keys()].filter((id) => !status.has(id));
        if (resolved.length > 0) {
          setEnteredPairingIds((prev) => {
            const next = new Set(prev);
            resolved.forEach((id) => next.add(id));
            return next;
          });
        }
        queuedStatusRef.current = status;
        setQueuedStatus(status);
      });
    };
    refresh();
    window.addEventListener(QUEUE_UPDATED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(QUEUE_UPDATED_EVENT, refresh);
    };
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId || !roundNum) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      loadPlayersWithFallback(tournamentId),
      // Pairings has no offline cache in this step's scope — it's fetched
      // fresh every time, same as before.
      getPairings(tournamentId, roundNum),
      loadStandingsWithFallback(tournamentId, roundNum),
    ])
      .then(([playersResult, pairings, standingsResult]) => {
        if (cancelled) return;
        setPlayersById(new Map(playersResult.data.map((p) => [p.id, p.display_name])));
        setPairingsData(pairings);
        setStandings(standingsResult.data);
        // Seeds from the server's view of "already has a result" — without
        // this, a reload (routine on mobile: OS backgrounding, PWA
        // relaunch, an autoUpdate reload) would forget every result already
        // recorded in a prior session and show the blank form again.
        setEnteredPairingIds(
          (prev) =>
            new Set([...prev, ...pairings.pairings.filter((p) => p.has_result).map((p) => p.id)]),
        );

        const cachedParts = [
          playersResult.fromCache && playersResult.fetchedAt != null
            ? `players (${formatRelativeTime(playersResult.fetchedAt)})`
            : null,
          standingsResult.fromCache && standingsResult.fetchedAt != null
            ? `standings (${formatRelativeTime(standingsResult.fetchedAt)})`
            : null,
        ].filter((v): v is string => v !== null);
        setCacheBanner(cachedParts.length > 0 ? `Showing cached ${cachedParts.join(' and ')} — offline` : null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.code : 'Failed to load round data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tournamentId, roundNum]);

  const nameFor = useMemo(
    () => (playerId: string | undefined) => (playerId ? playersById.get(playerId) ?? playerId : ''),
    [playersById],
  );

  if (!tournamentId || !roundNum) {
    return (
      <>
        <AppHeader />
        <main className="page">Invalid round URL.</main>
      </>
    );
  }
  if (loading) {
    return (
      <>
        <AppHeader />
        <main className="page">Loading round…</main>
      </>
    );
  }
  if (loadError) {
    return (
      <>
        <AppHeader />
        <main className="page" role="alert">
          {loadError}
        </main>
      </>
    );
  }
  if (!pairingsData) {
    return (
      <>
        <AppHeader />
        <main className="page">No data.</main>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <h1>
          Round {pairingsData.round.round_number} — {pairingsData.round.phase} ({pairingsData.round.status})
        </h1>
        {!isOnline && <p role="status">Offline — results will be queued and sent once you're back online.</p>}
        {cacheBanner && <p role="status">{cacheBanner}</p>}

        <section>
          <h2>Pairings</h2>
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
                {pairingsData.pairings.map((pairing) => (
                  <tr key={pairing.id}>
                    <td>{pairing.table_number}</td>
                    <td>{nameFor(pairing.player1_id)}</td>
                    <td>{pairing.is_bye ? 'BYE' : nameFor(pairing.player2_id)}</td>
                    <td>
                      {pairing.is_bye
                        ? '—'
                        : renderResultCell({
                            tournamentId,
                            pairing,
                            entered: enteredPairingIds.has(pairing.id),
                            queuedStatus: queuedStatus.get(pairing.id),
                            onSubmitted: () =>
                              setEnteredPairingIds((prev) => new Set(prev).add(pairing.id)),
                          })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Standings</h2>
          {standings.length === 0 && <p>Standings not yet available for this round.</p>}
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
                {standings.map((s) => (
                  <tr key={s.id}>
                    <td>{s.rank ?? '—'}</td>
                    <td>{nameFor(s.player_id)}</td>
                    <td>{s.match_points}</td>
                    <td>
                      {s.match_wins}-{s.match_losses}-{s.match_draws}
                    </td>
                    <td>{s.omw_percent != null ? `${s.omw_percent}%` : '—'}</td>
                    <td>{s.gw_percent != null ? `${s.gw_percent}%` : '—'}</td>
                    <td>{s.ogw_percent != null ? `${s.ogw_percent}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
