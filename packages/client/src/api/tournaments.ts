import type { TournamentPlayerView } from '@dueltrack/shared';
import { apiRequest } from './client';

export function getPlayers(tournamentId: string): Promise<TournamentPlayerView[]> {
  return apiRequest<TournamentPlayerView[]>(`/tournaments/${tournamentId}/players`);
}
