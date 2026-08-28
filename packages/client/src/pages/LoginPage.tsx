import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { login } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../hooks/useAuth';

const ROUND_PATH_RE = /^\/t\/[^/]+\/r\/\d+$/;

// Only follow ?redirect= back to a round page or the dashboard — never an
// arbitrary path, so a crafted link can't use this as an open redirect.
function isSafeRedirect(path: string): boolean {
  return path === '/dashboard' || ROUND_PATH_RE.test(path);
}

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      setUser(user);
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
