import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { publishStandings } from '../api/standings';
import { ApiError } from '../api/client';

function publishErrorMessage(code: string): string {
  switch (code) {
    case 'FORBIDDEN':
      return 'Only the tournament organizer can publish standings.';
    case 'STANDINGS_NOT_FOUND':
      return 'There are no standings for this round yet.';
    case 'TOURNAMENT_NOT_FOUND':
      return 'This tournament no longer exists.';
    default:
      return 'Failed to publish standings. Please try again.';
  }
}

// Rendered by RoundPage only for standings fetched live (never from the
// offline cache) — the standings GET returns unpublished rows to the
// organizer alone and 404s for everyone else, so live unpublished standings
// already mean the viewer is the organizer. The server still enforces that
// on publish; FORBIDDEN is handled above in case the read rule ever widens.
export function PublishStandings({
  tournamentId,
  roundNumber,
  isPublished,
  isOnline,
  onPublished,
}: {
  tournamentId: string;
  roundNumber: number;
  isPublished: boolean;
  isOnline: boolean;
  onPublished: (roundNumber: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusAfterToggle = useRef(false);
  const justPublished = useRef(false);

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
    (confirming ? confirmButtonRef : publishButtonRef).current?.focus();
  }, [confirming]);

  // A successful publish removes the focused Confirm button along with the
  // whole actions row — land focus on the (now "Published") status line
  // instead of letting it fall to <body>.
  useEffect(() => {
    if (isPublished && justPublished.current) {
      justPublished.current = false;
      statusRef.current?.focus();
    }
  }, [isPublished]);

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      await publishStandings(tournamentId, roundNumber);
      justPublished.current = true;
      onPublished(roundNumber);
    } catch (err) {
      setError(err instanceof ApiError ? publishErrorMessage(err.code) : 'Failed to publish standings. Please try again.');
      toggleConfirm(false);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="publish-standings">
      {/* One live region kept mounted across both states, with only its text
          changing — a role="status" element that mounts already filled in is
          often not announced by screen readers at all. */}
      <p ref={statusRef} role="status" tabIndex={-1}>
        {isPublished ? (
          <>
            Published — visible on the{' '}
            <Link to={`/t/${tournamentId}?round=${roundNumber}`}>public tournament page</Link>.
          </>
        ) : (
          "Not published yet — players and spectators can't see these standings until you publish them."
        )}
      </p>
      {!isPublished && (
        <>
          <div className="publish-standings__actions">
            {confirming ? (
              <>
                <span>Publish Round {roundNumber} standings to the public page? This can't be undone.</span>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className="button button--primary"
                  disabled={publishing || !isOnline}
                  onClick={handlePublish}
                >
                  {publishing ? 'Publishing…' : 'Confirm'}
                </button>
                <button type="button" disabled={publishing} onClick={() => toggleConfirm(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                ref={publishButtonRef}
                type="button"
                className="button button--primary"
                disabled={!isOnline}
                onClick={() => {
                  setError(null);
                  toggleConfirm(true);
                }}
              >
                Publish standings
              </button>
            )}
          </div>
          {!isOnline && <p role="status">You're offline — publishing needs a connection.</p>}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
