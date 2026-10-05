import type { Standing } from '@dueltrack/shared';
import { apiRequest } from './client';

// Standing has no display_name — join against the players map (see api/tournaments.ts).
export function getStandings(tournamentId: string, roundNumber: number): Promise<Standing[]> {
  return apiRequest<Standing[]>(`/tournaments/${tournamentId}/rounds/${roundNumber}/standings`);
}

// Organizer-only, one-way: there's no unpublish endpoint, so callers should
// confirm before calling this.
export function publishStandings(tournamentId: string, roundNumber: number): Promise<{ published: true }> {
  return apiRequest<{ published: true }>(`/tournaments/${tournamentId}/rounds/${roundNumber}/publish`, {
    method: 'POST',
  });
}
