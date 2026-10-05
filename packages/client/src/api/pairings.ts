import type { Round, Pairing } from '@dueltrack/shared';
import { apiRequest } from './client';

export interface PairingsResponse {
  round: Round;
  pairings: Pairing[];
  // Whether the caller organizes this tournament — gates organizer-only
  // controls on the round page; the server still checks every action.
  viewer_is_organizer: boolean;
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

export type AdvanceRoundResponse =
  | { completed: true; round_number: number }
  | { completed: false; round: Round; pairings: Pairing[]; warning?: string };

// Organizer-only, one-way: closes the active round (results become final,
// standings are computed) and pairs the next round, starts the top cut, or
// completes the tournament after the last round. roundNumber is the round
// the caller means to close; the server refuses (ROUND_NOT_ACTIVE) if a
// different round is active, so a stale page can't close the wrong one.
export function advanceRound(tournamentId: string, roundNumber: number): Promise<AdvanceRoundResponse> {
  return apiRequest<AdvanceRoundResponse>(`/tournaments/${tournamentId}/advance`, {
    method: 'POST',
    body: { round_number: roundNumber },
  });
}
