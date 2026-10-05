import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Standing, TournamentPlayerView } from '@dueltrack/shared';
import { getPlayers } from '../api/tournaments';
import { getPairings, PairingsResponse } from '../api/pairings';
import { getStandings } from '../api/standings';
import { ApiError } from '../api/client';
import { getCachedPlayers, getCachedStandings, setCachedPlayers, setCachedStandings } from '../offline/standingsCache';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getQueuedStatusForTournament, QUEUE_UPDATED_EVENT, QueuedStatusEntry } from '../offline/syncQueue';
import { AppHeader } from '../components/AppHeader';
import { RoundTimer } from '../components/RoundTimer';
import { PublishStandings } from '../components/PublishStandings';
import { renderResultCell } from '../components/ResultEntry';
import { AdvanceRound } from '../components/AdvanceRound';
import type { AdvanceRoundResponse } from '../api/pairings';

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

export function RoundPage() {
  const { tournamentId, roundNumber } = useParams<{ tournamentId: string; roundNumber: string }>();
  const roundNum = Number(roundNumber);
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  // Set by a successful "Close round" on the previous round's page, so this
  // page can say so — and, for a Swiss round, point back to publish its
  // standings (elimination rounds never get standings).
  const navState = useLocation().state as { closedRound?: number; closedPhase?: string } | null;
  const closedRound = navState?.closedRound;
  const closedPhase = navState?.closedPhase;
  const [reloadKey, setReloadKey] = useState(0);
  // Closing the last round has no next page to go to: this page reloads in
  // place and shows the completion note for the round that was closed.
  const [completedNote, setCompletedNote] = useState<{ round: number; phase: string } | null>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  // Bumped by every full load (round change, reload) and every results
  // check; a check's response only applies if nothing newer started since.
  // Bumped in effects/handlers, never during render, so a render React
  // discards (concurrent navigation) can't move it.
  const generation = useRef(0);
  const loadingRef = useRef(true);

  const [playersById, setPlayersById] = useState<Map<string, string>>(new Map());
  const [pairingsData, setPairingsData] = useState<PairingsResponse | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [standingsFromCache, setStandingsFromCache] = useState(false);
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
    generation.current++;
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
        setStandingsFromCache(standingsResult.fromCache);
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
  }, [tournamentId, roundNum, reloadKey]);

  const nameFor = useMemo(
    () => (playerId: string | undefined) => (playerId ? playersById.get(playerId) ?? playerId : ''),
    [playersById],
  );

  // Results a queued submission found already recorded by someone else
  // ('conflict') are on the server — they don't block closing the round.
  const missingResults = pairingsData
    ? pairingsData.pairings.filter(
        (p) => !p.is_bye && !enteredPairingIds.has(p.id) && queuedStatus.get(p.id)?.status !== 'conflict',
      ).length
    : 0;

  // Judges enter results on their own devices and nothing pushes them here,
  // so re-read which pairings have results (pairings only — no full reload).
  // Also picks up the round having been closed from another tab.
  async function checkForResults() {
    // A full load is already fetching fresh data (e.g. the reload a check
    // just triggered) — another check now would only trigger a second one.
    if (!tournamentId || loadingRef.current) return;
    const gen = ++generation.current;
    try {
      const fresh = await getPairings(tournamentId, roundNum);
      if (generation.current !== gen) return;
      // Closed elsewhere (another tab or device): reload fully, so its new
      // standings and the Publish control appear — not just the status.
      if (fresh.round.status !== 'active') {
        setReloadKey((k) => k + 1);
        return;
      }
      setPairingsData(fresh);
      setEnteredPairingIds(
        (prev) => new Set([...prev, ...fresh.pairings.filter((p) => p.has_result).map((p) => p.id)]),
      );
    } catch {
      // Best-effort background refresh — the next tick or a reload retries.
    }
  }

  const pollForResults =
    !!pairingsData?.viewer_is_organizer && pairingsData.round.status === 'active' && missingResults > 0 && isOnline;
  useEffect(() => {
    if (!pollForResults) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkForResults();
    }, 15_000);
    // A tab coming back to the foreground checks right away rather than
    // waiting out the rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForResults();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // checkForResults only closes over tournamentId/roundNum (deps here) plus
    // refs and state setters, so it needn't be re-created on every render.
  }, [pollForResults, tournamentId, roundNum]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Land focus on the "Round N closed" / "Tournament complete" note: the
  // Close button that had focus is gone, and a status line that mounts
  // already filled in is often not announced on its own.
  useEffect(() => {
    if (!loading) noteRef.current?.focus();
  }, [loading, closedRound, completedNote]);

  function handleAdvanced(result: AdvanceRoundResponse) {
    const phase = pairingsData?.round.phase ?? 'swiss';
    if (result.completed) {
      setCompletedNote({ round: roundNum, phase });
      setReloadKey((k) => k + 1);
      return;
    }
    navigate(`/t/${tournamentId}/r/${result.round.round_number}`, {
      state: { closedRound: roundNum, closedPhase: phase },
    });
  }

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
        <RoundTimer
          status={pairingsData.round.status}
          startedAt={pairingsData.round.started_at}
          timerMinutes={pairingsData.round.timer_minutes}
        />
        {!isOnline && <p role="status">Offline — results will be queued and sent once you're back online.</p>}
        {cacheBanner && <p role="status">{cacheBanner}</p>}
        {completedNote?.round === roundNum ? (
          <p ref={noteRef} role="status" tabIndex={-1}>
            Tournament complete.{' '}
            {completedNote.phase === 'elimination'
              ? 'The final has been decided. Swiss standings are on each Swiss round’s page.'
              : 'Review and publish the final standings below.'}
          </p>
        ) : (
          closedRound != null &&
          closedRound !== roundNum && (
            <p ref={noteRef} role="status" tabIndex={-1}>
              Round {closedRound} closed.{' '}
              {closedPhase === 'elimination' ? (
                'Its winners have advanced to this round.'
              ) : (
                <>
                  <Link to={`/t/${tournamentId}/r/${closedRound}`}>Review and publish its standings</Link>.
                </>
              )}
            </p>
          )
        )}
        {pairingsData.viewer_is_organizer && pairingsData.round.status === 'active' && (
          <AdvanceRound
            tournamentId={tournamentId}
            roundNumber={pairingsData.round.round_number}
            phase={pairingsData.round.phase}
            missingResults={missingResults}
            isOnline={isOnline}
            onCheckResults={checkForResults}
            onAdvanced={handleAdvanced}
          />
        )}

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
                            player1Name: nameFor(pairing.player1_id),
                            player2Name: nameFor(pairing.player2_id),
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
          {standings.length === 0 && (
            <p>
              {pairingsData.round.phase === 'elimination'
                ? 'Elimination rounds have no standings — the bracket decides who advances.'
                : 'Standings not yet available for this round.'}
            </p>
          )}
          {standings.length > 0 && !standingsFromCache && (
            <PublishStandings
              tournamentId={tournamentId}
              roundNumber={roundNum}
              isPublished={standings[0].is_published}
              isOnline={isOnline}
              // Matched on the rows' own round_number: a publish that resolves
              // after the URL moved to another round must not mark that round.
              onPublished={(publishedRound) =>
                setStandings((prev) =>
                  prev.map((s) => (s.round_number === publishedRound ? { ...s, is_published: true } : s)),
                )
              }
            />
          )}
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
