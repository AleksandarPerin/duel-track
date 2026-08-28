import type { UserRole } from '@dueltrack/shared';
import { apiRequest } from './client';

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
