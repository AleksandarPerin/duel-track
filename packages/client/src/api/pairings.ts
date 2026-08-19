import type { Round, Pairing } from '@dueltrack/shared';
import { apiRequest } from './client';

export interface PairingsResponse {
  round: Round;
  pairings: Pairing[];
}

export function getPairings(tournamentId: string, roundNumber: number): Promise<PairingsResponse> {
  return apiRequest<PairingsResponse>(`/tournaments/${tournamentId}/rounds/${roundNumber}/pairings`);
}
