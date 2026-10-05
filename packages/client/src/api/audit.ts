import type { AuditLogPage } from '@dueltrack/shared';
import { apiRequest } from './client';

// Organizer-only. Newest first; pass the previous page's next_cursor as
// `before` to load older entries.
export function getAuditLog(tournamentId: string, before?: string): Promise<AuditLogPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiRequest<AuditLogPage>(`/tournaments/${tournamentId}/audit${query}`);
}
