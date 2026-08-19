import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { login } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../hooks/useAuth';

const ROUND_PATH_RE = /^\/t\/[^/]+\/r\/\d+$/;

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      setUser(user);
      // Only follow ?redirect= back to a round page — never an arbitrary
      // path, so a crafted link can't use this as an open redirect.
      const redirect = searchParams.get('redirect');
      if (redirect && ROUND_PATH_RE.test(redirect)) {
        navigate(redirect, { replace: true });
      } else {
        setSignedIn(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'LOGIN_FAILED');
    } finally {
      setSubmitting(false);
    }
  }

  if (signedIn) {
    return (
      <main>
        <h1>DuelTrack — Judge Sign In</h1>
        <p>Signed in. Navigate to your round's URL to continue.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>DuelTrack — Judge Sign In</h1>
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
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
