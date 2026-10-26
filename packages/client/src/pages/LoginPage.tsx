import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { LeftBehindNotice } from '../components/AppHeader';
import { clearPendingLogout, completePendingLogout, login } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { setSessionUserId } from '../api/sessionUser';
import { resumeAuthRequired } from '../offline/syncQueue';

const ROUND_PATH_RE = /^\/t\/[^/]+\/r\/\d+$/;
const AUDIT_PATH_RE = /^\/t\/[^/]+\/audit$/;
// Registration links carry a ?signedIn=1 query string back from LoginPage —
// anchoring the path to exactly /register/<64-hex-token> before the '?' means
// that suffix can't be abused for an open redirect (a query string can't
// change the origin a relative path resolves against).
const REGISTER_PATH_RE = /^\/register\/[0-9a-f]{64}(\?.*)?$/i;

// Only follow ?redirect= back to a round page, an activity log, a
// registration link, or the dashboard — never an arbitrary path, so a
// crafted link can't use this as an open redirect.
function isSafeRedirect(path: string): boolean {
  return path === '/dashboard' || ROUND_PATH_RE.test(path) || AUDIT_PATH_RE.test(path) || REGISTER_PATH_RE.test(path);
}

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Set by AppHeader when the previous user signed out with results still
  // queued on this device — whoever picks the phone up next should know.
  // Read once, then dropped from history: router state survives reloads,
  // and a reload later on (after those results synced) would show a stale
  // notice.
  const location = useLocation();
  const [leftBehind] = useState(() => (location.state as { leftBehind?: LeftBehindNotice } | null)?.leftBehind);
  useEffect(() => {
    if (location.state) navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location, navigate]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    // Nobody counts as signed in while this runs: B's cookies land as soon
    // as the login response arrives, before setSessionUserId(B) below, and
    // a flush still sending as the previous user (another tab) must not
    // send in that gap. A failed sign-in just leaves nobody signed in.
    setSessionUserId(null);
    try {
      // The previous user's sign-out may not have reached the server (see
      // logoutDuringNavigation) — revoke their refresh token before this
      // sign-in replaces their cookie.
      await completePendingLogout();
      const user = await login(email, password);
      clearPendingLogout();
      setUser(user);
      setSessionUserId(user.id, user.display_name);
      // This user's results parked while signed out (a 401 mid-entry or
      // mid-sync) can go now — not awaited, so sign-in isn't held up by the
      // sync. Any future sign-in path (e.g. Google OAuth landing back in the
      // client) needs these same two calls.
      void resumeAuthRequired(user.id);
      const redirect = searchParams.get('redirect');
      navigate(redirect && isSafeRedirect(redirect) ? redirect : '/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'LOGIN_FAILED');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page page--centered">
      <div className="auth-card">
        <h1>DuelTrack</h1>
        <p className="auth-card__subtitle">Judge &amp; organizer sign in</p>
        {leftBehind && (
          <p role="status">
            {leftBehind.count === 1 ? '1 result' : `${leftBehind.count} results`}
            {leftBehind.name ? ` from ${leftBehind.name}` : ''} {leftBehind.count === 1 ? 'is' : 'are'} still on this
            phone. {leftBehind.count === 1 ? 'It' : 'They'}’ll sync when {leftBehind.name ?? 'the judge who entered them'}{' '}
            signs in here.
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p role="alert">{error}</p>}
          <button type="submit" className="button button--primary" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
