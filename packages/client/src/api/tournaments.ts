import type { Tournament, TournamentPlayerView } from '@dueltrack/shared';
import { apiRequest } from './client';

export function getPlayers(tournamentId: string): Promise<TournamentPlayerView[]> {
  return apiRequest<TournamentPlayerView[]>(`/tournaments/${tournamentId}/players`);
}

export function getTournament(tournamentId: string): Promise<Tournament> {
  return apiRequest<Tournament>(`/tournaments/${tournamentId}`);
}
