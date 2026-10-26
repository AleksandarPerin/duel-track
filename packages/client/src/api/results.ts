import type { ResultInput, Result } from '@dueltrack/shared';
import { apiRequest } from './client';

export function submitResult(
  tournamentId: string,
  pairingId: string,
  body: ResultInput,
): Promise<Result> {
  // skipAuthRedirect: the form parks the result in the offline queue on a
  // 401 before redirecting, rather than losing what the judge just entered.
  return apiRequest<Result>(`/tournaments/${tournamentId}/pairings/${pairingId}/result`, {
    method: 'POST',
    body,
    skipAuthRedirect: true,
  });
}
