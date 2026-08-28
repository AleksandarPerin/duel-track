import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TournamentRegistrationView } from '@dueltrack/shared';
import { getTournament } from '../api/tournaments';
import { decideRegistration, getRegistrationLink, listRegistrations } from '../api/registrations';
import { ApiError } from '../api/client';
import { AppHeader } from '../components/AppHeader';

function decisionErrorMessage(code: string): string {
  switch (code) {
    case 'REGISTRATION_ALREADY_DECIDED':
      return 'Someone already decided this registration.';
    case 'TOURNAMENT_NOT_EDITABLE':
      return "Can't add players — the tournament has already started.";
    case 'PLAYER_ALREADY_REGISTERED':
      return 'That person was already added as a player — this entry was auto-rejected.';
    default:
      return `Failed to decide (${code}).`;
  }
}

function RegistrationRow({
  registration,
  onDecide,
}: {
  registration: TournamentRegistrationView;
  onDecide: (id: string, decision: 'approved' | 'rejected') => void;
}) {
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approved' | 'rejected') {
    setDeciding(decision);
    setError(null);
    try {
      await onDecide(registration.id, decision);
    } catch (err) {
      setError(err instanceof ApiError ? decisionErrorMessage(err.code) : 'Failed to decide.');
    } finally {
      setDeciding(null);
    }
  }

  return (
    <li className="registration-row">
      <div className="registration-row__main">
        <span className="registration-row__name">{registration.display_name}</span>
        {registration.guest_email && <span className="registration-row__email">{registration.guest_email}</span>}
      </div>
      {registration.status === 'pending' ? (
        <div className="registration-row__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={deciding !== null}
            onClick={() => decide('approved')}
          >
            {deciding === 'approved' ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" disabled={deciding !== null} onClick={() => decide('rejected')}>
            {deciding === 'rejected' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      ) : (
        <span className={`badge ${registration.status === 'approved' ? 'badge--organizer' : 'badge--judge'}`}>
          {registration.status}
        </span>
      )}
      {error && <p role="alert">{error}</p>}
    </li>
  );
}

export function TournamentRegistrationsPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [tournamentName, setTournamentName] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [registrations, setRegistrations] = useState<TournamentRegistrationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // refresh() is called both from the mount effect and from handleDecide
  // (well after mount), so a plain effect-scoped `cancelled` flag can't guard
  // it — track the tournamentId a given call was issued for instead, so a
  // late response for a since-abandoned tournamentId can't overwrite a
  // newer one's list.
  const tournamentIdRef = useRef(tournamentId);
  tournamentIdRef.current = tournamentId;

  const refresh = useCallback(() => {
    if (!tournamentId) return;
    const requestedFor = tournamentId;
    listRegistrations(tournamentId)
      .then((data) => {
        if (tournamentIdRef.current === requestedFor) setRegistrations(data);
      })
      .catch((err) => {
        if (tournamentIdRef.current !== requestedFor) return;
        setError(err instanceof ApiError ? err.code : 'Failed to load registrations.');
      });
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;

    getTournament(tournamentId)
      .then((t) => {
        if (!cancelled) setTournamentName(t.name);
      })
      .catch(() => {
        // Non-fatal — the page still works without a name in the header.
      });

    getRegistrationLink(tournamentId)
      .then(({ path }) => {
        if (!cancelled) setLink(`${window.location.origin}${path}`);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'Failed to load the signup link.');
      });

    refresh();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, refresh]);

  async function handleDecide(registrationId: string, decision: 'approved' | 'rejected') {
    if (!tournamentId) return;
    try {
      await decideRegistration(tournamentId, registrationId, decision);
    } finally {
      // A decision call can mutate state even when it throws — approving a
      // registration whose person was independently added as a player in
      // the meantime auto-rejects it server-side and still errors
      // (PLAYER_ALREADY_REGISTERED) — so always refresh, not just on
      // success, or that row would keep showing as pending.
      refresh();
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const pending = registrations?.filter((r) => r.status === 'pending') ?? [];
  const decided = registrations?.filter((r) => r.status !== 'pending') ?? [];

  return (
    <>
      <AppHeader />
      <main className="page">
        <h1>Signups{tournamentName ? ` — ${tournamentName}` : ''}</h1>
        {tournamentId && (
          <p>
            <Link to={`/t/${tournamentId}`}>View public tournament page →</Link>
          </p>
        )}
        {error && <p role="alert">{error}</p>}

        {link && (
          <section className="registration-link">
            <label htmlFor="regLink">Shareable signup link</label>
            <div className="registration-link__row">
              <input id="regLink" type="text" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="button" onClick={copyLink}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </section>
        )}

        <section>
          <h2>Pending ({pending.length})</h2>
          {pending.length === 0 && <p>No pending registrations.</p>}
          {pending.length > 0 && (
            <ul className="registration-list">
              {pending.map((r) => (
                <RegistrationRow key={r.id} registration={r} onDecide={handleDecide} />
              ))}
            </ul>
          )}
        </section>

        {decided.length > 0 && (
          <section>
            <h2>Decided</h2>
            <ul className="registration-list">
              {decided.map((r) => (
                <RegistrationRow key={r.id} registration={r} onDecide={handleDecide} />
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
