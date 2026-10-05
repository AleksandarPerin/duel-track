import type { TournamentExport } from '@dueltrack/shared';
import { apiRequest } from './client';

// The export is served with a short public Cache-Control (public.routes.ts);
// `revalidate` skips the browser's copy when the caller knows it may be stale
// (e.g. the organizer arriving right after publishing standings).
export function getTournamentExport(
  tournamentId: string,
  opts: { revalidate?: boolean } = {},
): Promise<TournamentExport> {
  return apiRequest(`/public/tournaments/${tournamentId}/export/json`, {
    cache: opts.revalidate ? 'no-cache' : undefined,
  });
}
