import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { PublicTournamentInfo } from '@dueltrack/shared';
import { getPublicTournamentInfo, submitRegistration } from '../api/publicRegistration';
import { ApiError } from '../api/client';

const TOKEN_RE = /^[0-9a-f]{64}$/i;

const ERROR_MESSAGES: Record<string, string> = {
  LINK_NOT_FOUND: 'This registration link is invalid.',
  REGISTRATION_CLOSED: 'Registration for this tournament is closed.',
  ALREADY_PLAYER: "You're already registered for this tournament.",
  ALREADY_REGISTERED: 'You already have a pending or approved registration for this tournament.',
  GUEST_NAME_REQUIRED: 'Enter your name to register as a guest.',
  INVALID_REGISTRATION: "You can't register for this tournament.",
};

function errorMessageFor(err: unknown): string {
  if (err instanceof ApiError) return ERROR_MESSAGES[err.code] ?? `Registration failed (${err.code}).`;
  return 'Registration failed. Please try again.';
}

export function RegisterPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [info, setInfo] = useState<PublicTournamentInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const justSignedIn = searchParams.get('signedIn') === '1';

  useEffect(() => {
    if (!token || !TOKEN_RE.test(token)) {
      setLoadError(ERROR_MESSAGES.LINK_NOT_FOUND);
      return;
    }
    let cancelled = false;
    getPublicTournamentInfo(token)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessageFor(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitRegistration(token, { guestName, guestEmail });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(errorMessageFor(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="page page--centered">
        <div className="auth-card">
          <h1>DuelTrack</h1>
          <p role="alert">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!info) {
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
    <main className="page page--centered">
      <div className="auth-card">
        <h1>{info.name}</h1>
        <p className="auth-card__subtitle">
          {info.format} · {info.rel_level}
          {info.venue ? ` · ${info.venue}` : ''}
        </p>

        {info.status !== 'registration' ? (
          <p role="alert">Registration for this tournament is closed.</p>
        ) : submitted ? (
          <>
            <p role="status">
              Registration submitted — the organizer will review it and add you to the tournament.
            </p>
            {/* Submitting only succeeds while the tournament is still in
                'registration' status, which is exactly the status
                fetchTournamentExport (this page's data source) excludes —
                so pairings/standings can't exist yet. Framed as "once it
                starts" rather than an immediate "View tournament" action,
                since clicking it right now would only ever show "hasn't
                started yet," contradicting the success message above it. */}
            <p className="auth-card__footnote">
              Once the tournament starts, pairings and standings will be posted at{' '}
              <Link to={`/t/${info.id}`}>this page</Link> — worth bookmarking.
            </p>
          </>
        ) : (
          <>
            {justSignedIn && (
              <p role="status">Signed in — leave the name field blank to register under your account.</p>
            )}
            <form onSubmit={handleSubmit}>
              <label htmlFor="guestName">Name</label>
              <input
                id="guestName"
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder={justSignedIn ? 'Leave blank to use your account name' : 'Your name'}
              />
              <label htmlFor="guestEmail">Email (optional)</label>
              <input
                id="guestEmail"
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
              />
              {submitError && <p role="alert">{submitError}</p>}
              <button type="submit" className="button button--primary" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Register'}
              </button>
            </form>
            {!justSignedIn && (
              <p className="auth-card__footnote">
                Already have an account?{' '}
                <Link to={`/login?redirect=${encodeURIComponent(`/register/${token}?signedIn=1`)}`}>Sign in</Link>{' '}
                to register under your account instead of as a guest.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
