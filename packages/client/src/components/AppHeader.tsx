import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout, logoutDuringNavigation } from '../api/auth';
import { ApiError, isRedirectingToLogin } from '../api/client';
import { getSessionUserId, getSessionUserName, setSessionUserId } from '../api/sessionUser';
import { useAuth } from '../hooks/useAuth';
import { countUnsentForUser, flushQueue } from '../offline/syncQueue';

// How long sign-out waits for queued results to send before signing out
// regardless — a slow venue connection must not keep a session open on a
// shared phone after its judge has walked away.
const SIGN_OUT_SEND_CAP_MS = 8_000;

// Passed to LoginPage (router state) when results were left on the device.
export interface LeftBehindNotice {
  count: number;
  name: string | null;
}

export function AppHeader() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'idle' | 'sending' | 'signing-out'>('idle');
  const [error, setError] = useState<string | null>(null);
  // The re-entry guard: `phase` is read from the render closure, so two taps
  // before React re-renders (a slow phone) would both see 'idle'.
  const busy = useRef(false);

  function signedOut(leftBehind: LeftBehindNotice | null) {
    setUser(null);
    // Their queued results stay on the device but are no longer sent
    // under anyone's session until they sign in here again.
    setSessionUserId(null);
    navigate('/login', { replace: true, state: leftBehind ? { leftBehind } : undefined });
  }

  async function handleSignOut() {
    // aria-disabled, not disabled, while busy: a disabled button drops
    // keyboard focus to <body>. So the guard lives here.
    if (busy.current) return;
    busy.current = true;
    setError(null);

    // Always ends in signing out (or a visible failure) — never parked on a
    // question: a judge who taps Sign out and walks away must not leave
    // their session open for the next person at the phone. Unsent results
    // are safe either way (owned, resumed when they sign in here again), so
    // they're sent if quick, and otherwise reported on the login page.
    const userId = getSessionUserId();
    let leftBehind: LeftBehindNotice | null = null;
    if (userId) {
      setPhase('sending');
      try {
        await Promise.race([flushQueue(), new Promise((resolve) => setTimeout(resolve, SIGN_OUT_SEND_CAP_MS))]);
        // The flush hit a 401 and the page is already on its way to /login.
        // That 401 only means the 15-minute access token expired — the
        // 7-day refresh cookie is still live on this shared phone, and only
        // /auth/logout revokes it. keepalive, so the request survives the
        // navigation that's already under way (see logoutDuringNavigation,
        // which also retries it on the next load if it doesn't make it).
        if (isRedirectingToLogin()) {
          logoutDuringNavigation();
          setSessionUserId(null);
          return;
        }
        const count = await countUnsentForUser(userId);
        if (count > 0) leftBehind = { count, name: getSessionUserName() ?? user?.display_name ?? null };
      } catch {
        // Sending or counting failed (e.g. IndexedDB unavailable) — that
        // must never stand in the way of signing out.
      }
    }

    setPhase('signing-out');
    try {
      await logout();
      signedOut(leftBehind);
    } catch (err) {
      // A 401 means the session was already invalid server-side (e.g. an
      // expired token) — nothing left to clear, so treating it as a
      // successful sign-out is correct. Any other failure (network, 5xx)
      // means the session cookie may still be valid server-side, so don't
      // claim success — this app runs on shared devices at tournament
      // venues, where a false "signed out" could leave the next person
      // able to act as the previous user.
      if (err instanceof ApiError && err.status === 401) {
        signedOut(leftBehind);
      } else {
        setError('Sign out failed — please try again.');
      }
    } finally {
      busy.current = false;
      setPhase('idle');
    }
  }

  const busyText = phase === 'sending' ? 'Sending queued results…' : phase === 'signing-out' ? 'Signing out…' : '';

  return (
    <header className="app-header">
      <Link to="/dashboard" className="app-header__brand">
        DuelTrack
      </Link>
      <div className="app-header__account">
        {user && <span className="app-header__name">{user.display_name}</span>}
        {error && (
          <span role="alert" className="app-header__error">
            {error}
          </span>
        )}
        <button
          type="button"
          className="button button--ghost"
          onClick={handleSignOut}
          aria-disabled={phase !== 'idle'}
        >
          {busyText || 'Sign out'}
        </button>
        {/* A focused button's changing label isn't reliably announced, so
            the busy phases are also said through a live region that's
            always mounted (one that mounts already filled is often missed). */}
        <span role="status" className="visually-hidden">
          {busyText}
        </span>
      </div>
    </header>
  );
}
