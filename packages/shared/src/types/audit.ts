export type AuditAction =
  | 'result_entered'
  | 'result_edited'
  | 'pairing_swapped'
  | 'player_dropped'
  | 'round_force_advanced'
  | 'standings_published'
  | 'player_added'
  | 'player_merged';

export interface AuditLogEntry {
  id: string;
  tournament_id: string;
  actor_id: string;
  action: AuditAction;
  entity_type?: string;
  entity_id?: string;
  detail: {
    before?: unknown;
    after?: unknown;
    reason?: string;
    [key: string]: unknown;
  };
  created_at: string;
}
