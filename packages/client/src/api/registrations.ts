import type { TournamentRegistrationView } from '@dueltrack/shared';
import { apiRequest } from './client';

export function getRegistrationLink(tournamentId: string): Promise<{ token: string; path: string }> {
  return apiRequest(`/tournaments/${tournamentId}/registration-link`);
}

export function listRegistrations(tournamentId: string): Promise<TournamentRegistrationView[]> {
  return apiRequest(`/tournaments/${tournamentId}/registrations`);
}

export function decideRegistration(
  tournamentId: string,
  registrationId: string,
  decision: 'approved' | 'rejected',
): Promise<TournamentRegistrationView> {
  return apiRequest(`/tournaments/${tournamentId}/registrations/${registrationId}/decision`, {
    method: 'POST',
    body: { decision },
  });
}
