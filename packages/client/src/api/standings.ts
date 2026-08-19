import type { Standing } from '@dueltrack/shared';
import { apiRequest } from './client';

// Standing has no display_name — join against the players map (see api/tournaments.ts).
export function getStandings(tournamentId: string, roundNumber: number): Promise<Standing[]> {
  return apiRequest<Standing[]>(`/tournaments/${tournamentId}/rounds/${roundNumber}/standings`);
}
