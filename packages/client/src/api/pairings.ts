import type { Round, Pairing } from '@dueltrack/shared';
import { apiRequest } from './client';

export interface PairingsResponse {
  round: Round;
  pairings: Pairing[];
}

export function getPairings(tournamentId: string, roundNumber: number): Promise<PairingsResponse> {
  return apiRequest<PairingsResponse>(`/tournaments/${tournamentId}/rounds/${roundNumber}/pairings`);
}

export interface StartTournamentResponse {
  round: { round_number: number };
  warning?: string;
}

export function startTournament(tournamentId: string): Promise<StartTournamentResponse> {
  return apiRequest<StartTournamentResponse>(`/tournaments/${tournamentId}/start`, { method: 'POST' });
}
