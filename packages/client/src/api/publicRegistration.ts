import type { PublicTournamentInfo, TournamentRegistrationView } from '@dueltrack/shared';
import { apiRequest } from './client';

export function getPublicTournamentInfo(token: string): Promise<PublicTournamentInfo> {
  return apiRequest(`/public/register/${token}`);
}

export function submitRegistration(
  token: string,
  input: { guestName: string; guestEmail: string },
): Promise<TournamentRegistrationView> {
  // Omit empty fields entirely rather than sending '' — the server schema
  // validates guest_name with .min(1) when present, so an empty string would
  // 400 as a validation error instead of the clean GUEST_NAME_REQUIRED the
  // server returns for a logged-in caller who left the name blank on
  // purpose (they don't need it; the server registers them as themselves).
  const body: { guest_name?: string; guest_email?: string } = {};
  if (input.guestName.trim()) body.guest_name = input.guestName.trim();
  if (input.guestEmail.trim()) body.guest_email = input.guestEmail.trim();

  return apiRequest(`/public/register/${token}`, { method: 'POST', body });
}
