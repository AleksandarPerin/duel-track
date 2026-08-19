import type { ResultInput, Result } from '@dueltrack/shared';
import { apiRequest } from './client';

export function submitResult(
  tournamentId: string,
  pairingId: string,
  body: ResultInput,
): Promise<Result> {
  return apiRequest<Result>(`/tournaments/${tournamentId}/pairings/${pairingId}/result`, {
    method: 'POST',
    body,
  });
}
