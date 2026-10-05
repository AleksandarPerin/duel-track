// Every action the server actually writes (see each route's safeAudit call).
// Stored as plain TEXT, so this union is the only list of valid values.
export type AuditAction =
  | 'tournament.created'
  | 'tournament.updated'
  | 'tournament.started'
  | 'player.added'
  | 'player.removed'
  | 'players.imported'
  | 'player.seeds_reordered'
  | 'result.entered'
  | 'round.completed'
  | 'round.force_advanced'
  | 'standings.published'
  | 'player.dropped'
  | 'judge.assigned'
  | 'judge.removed'
  | 'tournament.registration_opened'
  | 'registration.submitted'
  | 'registration.approved'
  | 'registration.rejected'
  | 'player.claimed'
  | 'player.linked_by_organizer';

export interface AuditLogEntry {
  id: string;
  tournament_id: string;
  actor_id: string;
  action: AuditAction;
  entity_type: string | null;
  entity_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

// Names resolved server-side at read time, so the organizer sees who/which
// table instead of raw ids. Each field is null when the entry isn't about
// that kind of thing, or when the row it pointed to no longer exists
// (player.removed deletes the tournament_players row it references).
// user_name resolves detail.user_id (judge.*, registration.*,
// player.linked_by_organizer).
export interface AuditLogContext {
  round_number: number | null;
  table_number: number | null;
  player1_name: string | null;
  player2_name: string | null;
  player_name: string | null;
  user_name: string | null;
}

export interface AuditLogView extends AuditLogEntry {
  actor_display_name: string;
  context: AuditLogContext;
}

export interface AuditLogPage {
  entries: AuditLogView[];
  // Pass as ?before= to fetch the next (older) page; null when there is none.
  next_cursor: string | null;
}
