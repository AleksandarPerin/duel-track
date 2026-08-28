import type { TournamentExport } from '@dueltrack/shared';
import { apiRequest } from './client';

export function getTournamentExport(tournamentId: string): Promise<TournamentExport> {
  return apiRequest(`/public/tournaments/${tournamentId}/export/json`);
}
