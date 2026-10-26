import type { UserRole } from '@dueltrack/shared';
import { apiRequest, fetchWithTimeout } from './client';

export interface LoginResponse {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  // A 401 here means wrong credentials, not an expired session — skip
  // apiRequest's global redirect-to-login so LoginPage's own catch block
  // gets to show the error instead of the page reloading itself away.
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuthRedirect: true,
  });
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST' });
}

// Signing out while the page is already navigating away (AppHeader: the
// pre-sign-out send hit a 401 and redirected). Only /auth/logout revokes the
// 7-day refresh cookie, so it must reach the server — keepalive lets it
// outlive the navigation, but older Firefox ignores keepalive and an offline
// moment loses it. So the attempt is also remembered, and finished by
// completePendingLogout() on the next load or before the next sign-in.
// Raw fetch: /auth/logout needs no CSRF token, and there's no page left to
// handle a response on.
const PENDING_LOGOUT_KEY = 'dueltrack:pendingLogout';

function setPendingLogout(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(PENDING_LOGOUT_KEY, '1');
    else localStorage.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    // Storage blocked: keepalive is the only attempt then.
  }
}

// Bounded: LoginPage awaits this before signing in, and a stalled venue
// connection must not hold sign-in up indefinitely.
function postLogout(init: RequestInit = {}): Promise<void> {
  return fetchWithTimeout('/api/auth/logout', { method: 'POST', credentials: 'include', ...init }, 5_000).then((res) => {
    if (res.ok) setPendingLogout(false);
  });
}

export function logoutDuringNavigation(): void {
  setPendingLogout(true);
  void postLogout({ keepalive: true }).catch(() => {});
}

export async function completePendingLogout(): Promise<void> {
  let pending = false;
  try {
    pending = localStorage.getItem(PENDING_LOGOUT_KEY) !== null;
  } catch {
    return;
  }
  if (pending) await postLogout().catch(() => {});
}

// A successful sign-in replaces the old refresh cookie, so a pending logout
// is moot — and retrying it later would sign out the *new* user.
export function clearPendingLogout(): void {
  setPendingLogout(false);
}
