import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { AuditLogView } from '@dueltrack/shared';
import { getAuditLog } from '../api/audit';
import { getTournament } from '../api/tournaments';
import { ApiError } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { describeAuditEntry } from '../audit/describeAuditEntry';

function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'FORBIDDEN') return 'Only the tournament organizer can view the activity log.';
    if (err.code === 'TOURNAMENT_NOT_FOUND') return 'This tournament no longer exists.';
  }
  return 'Failed to load the activity log. Please try again.';
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export function AuditLogPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [tournamentName, setTournamentName] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditLogView[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Bumped on every (re)load of the first page. A "load older" response is
  // only applied if no reload happened since it was sent: comparing the
  // tournament id instead would wrongly accept a stale page after A → B → A
  // navigation and append it under the fresh first page, silently skipping
  // any entries written in between.
  const generation = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    generation.current++;
    if (!tournamentId) return;
    let cancelled = false;
    setTournamentName(null);
    setEntries(null);
    setNextCursor(null);
    setError(null);
    setLoadingMore(false);
    setLoadMoreError(null);

    // The name is decoration — a failure there shouldn't hide the log itself.
    getTournament(tournamentId)
      .then((t) => {
        if (!cancelled) setTournamentName(t.name);
      })
      .catch(() => {});
    getAuditLog(tournamentId)
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setNextCursor(page.next_cursor);
      })
      .catch((err) => {
        if (!cancelled) setError(loadErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  // The Load older button unmounts once the last page arrives, which would
  // drop keyboard focus to <body> — move it to the first newly loaded entry.
  useEffect(() => {
    if (focusIndex.current == null) return;
    const item = listRef.current?.children[focusIndex.current] as HTMLElement | undefined;
    focusIndex.current = null;
    item?.focus();
  }, [entries]);

  async function loadOlder() {
    if (!tournamentId || !nextCursor || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await getAuditLog(tournamentId, nextCursor);
      if (generation.current !== gen) return;
      if (page.entries.length > 0) focusIndex.current = entries?.length ?? 0;
      setEntries((prev) => [...(prev ?? []), ...page.entries]);
      setNextCursor(page.next_cursor);
    } catch (err) {
      if (generation.current === gen) setLoadMoreError(loadErrorMessage(err));
    } finally {
      if (generation.current === gen) setLoadingMore(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <h1>Activity log</h1>
        {tournamentName && <p className="auth-card__subtitle">{tournamentName}</p>}
        <p>Changes recorded for this tournament, newest first.</p>

        {error && <p role="alert">{error}</p>}
        {!error && !entries && <p role="status">Loading activity…</p>}
        {entries && entries.length === 0 && <p>No activity recorded yet.</p>}

        {/* A list rather than a table: the description is the part that
            matters and needs the full width, which a three-column table
            pushed off-screen on a phone. role="list" because list-style:none
            strips list semantics in Safari/VoiceOver. */}
        {entries && entries.length > 0 && (
          <ol ref={listRef} className="audit-log" role="list">
            {entries.map((e) => (
              <li key={e.id} className="audit-log__entry" tabIndex={-1}>
                <p className="audit-log__what">{describeAuditEntry(e)}</p>
                <p className="audit-log__meta">
                  <time dateTime={e.created_at}>{TIME_FORMAT.format(new Date(e.created_at))}</time> ·{' '}
                  {e.actor_display_name}
                </p>
              </li>
            ))}
          </ol>
        )}

        {entries && nextCursor && (
          <button type="button" className="button audit-log__more" disabled={loadingMore} onClick={loadOlder}>
            {loadingMore ? 'Loading…' : 'Load older entries'}
          </button>
        )}
        {entries && entries.length > 0 && !nextCursor && (
          <p className="audit-log__end" role="status">
            That's the oldest recorded entry.
          </p>
        )}
        {loadMoreError && <p role="alert">{loadMoreError}</p>}
      </main>
    </>
  );
}
