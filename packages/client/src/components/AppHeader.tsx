import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../hooks/useAuth';

export function AppHeader() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await logout();
      setUser(null);
      navigate('/login', { replace: true });
    } catch (err) {
      // A 401 means the session was already invalid server-side (e.g. an
      // expired token) — nothing left to clear, so treating it as a
      // successful sign-out is correct. Any other failure (network, 5xx)
      // means the session cookie may still be valid server-side, so don't
      // claim success — this app runs on shared devices at tournament
      // venues, where a false "signed out" could leave the next person
      // able to act as the previous user.
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        navigate('/login', { replace: true });
      } else {
        setError('Sign out failed — please try again.');
      }
    } finally {
      setSigningOut(false);
    }
  }

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
        <button type="button" className="button button--ghost" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
