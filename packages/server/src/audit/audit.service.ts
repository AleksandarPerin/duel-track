import { pool } from '../db/pool';

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
  | 'judge.removed';

export async function writeAuditLog(params: {
  tournamentId: string;
  actorId: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  const { tournamentId, actorId, action, entityType, entityId, detail } = params;
  await pool.query(
    `INSERT INTO audit_log (tournament_id, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tournamentId, actorId, action, entityType ?? null, entityId ?? null, JSON.stringify(detail)],
  );
}
