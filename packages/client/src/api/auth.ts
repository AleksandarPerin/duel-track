import type { UserRole } from '@dueltrack/shared';
import { apiRequest } from './client';

export interface LoginResponse {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST' });
}
