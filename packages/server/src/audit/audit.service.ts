import { pool } from '../db/pool';
import type { AuditAction, AuditLogPage, AuditLogView } from '@dueltrack/shared';
import { AppError } from '../errors/AppError';

export type { AuditAction };

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

interface AuditLogRow extends Omit<AuditLogView, 'context'> {
  ctx_round_number: number | null;
  ctx_table_number: number | null;
  ctx_player1_name: string | null;
  ctx_player2_name: string | null;
  ctx_player_name: string | null;
  ctx_user_name: string | null;
}

// Organizer-only read path (PRD Phase 1: "append-only audit log, visible to
// TO"). Newest first, keyset-paginated on (created_at, id): the cursor is the
// last entry's id, resolved back to its own (created_at, id) inside the query
// so no timestamp ever round-trips through JS (Date would truncate
// Postgres's microseconds and skip or repeat rows at a page boundary).
export async function listAuditLog(
  tournamentId: string,
  actorId: string,
  opts: { limit: number; before?: string },
): Promise<AuditLogPage> {
  const { rows: tRows } = await pool.query<{ organizer_id: string }>(
    'SELECT organizer_id FROM tournaments WHERE id = $1',
    [tournamentId],
  );
  if (!tRows[0]) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
  if (tRows[0].organizer_id !== actorId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can view the audit log');
  }

  if (opts.before) {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM audit_log WHERE id = $1 AND tournament_id = $2',
      [opts.before, tournamentId],
    );
    if ((rowCount ?? 0) === 0) throw new AppError('INVALID_CURSOR', 'Unknown audit log cursor');
  }

  // limit + 1 to learn whether an older page exists without a COUNT(*).
  const { rows } = await pool.query<AuditLogRow>(
    `SELECT a.id, a.tournament_id, a.actor_id, a.action, a.entity_type, a.entity_id,
            a.detail, a.created_at,
            u.display_name AS actor_display_name,
            rd.round_number AS ctx_round_number,
            CASE WHEN rd.id IS NOT NULL THEN p.table_number END AS ctx_table_number,
            COALESCE(u1.display_name, tp1.guest_name) AS ctx_player1_name,
            COALESCE(u2.display_name, tp2.guest_name) AS ctx_player2_name,
            COALESCE(us.display_name, tps.guest_name) AS ctx_player_name,
            ud.display_name AS ctx_user_name
     FROM audit_log a
     JOIN users u ON u.id = a.actor_id
     LEFT JOIN results r ON a.entity_type = 'result' AND r.id = a.entity_id
     LEFT JOIN pairings p ON p.id = r.pairing_id
     -- Every context join is pinned to the entry's own tournament, so a bad
     -- entity_id written by some future caller can at worst resolve to
     -- nothing, never to another tournament's round, table or player names.
     LEFT JOIN rounds rd ON rd.id = p.round_id AND rd.tournament_id = a.tournament_id
     LEFT JOIN tournament_players tp1 ON tp1.id = p.player1_id AND tp1.tournament_id = a.tournament_id
     LEFT JOIN users u1 ON u1.id = tp1.user_id
     LEFT JOIN tournament_players tp2 ON tp2.id = p.player2_id AND tp2.tournament_id = a.tournament_id
     LEFT JOIN users u2 ON u2.id = tp2.user_id
     LEFT JOIN tournament_players tps
       ON a.entity_type = 'tournament_player' AND tps.id = a.entity_id AND tps.tournament_id = a.tournament_id
     LEFT JOIN users us ON us.id = tps.user_id
     -- CASE, not AND: Postgres doesn't promise AND short-circuits, and a
     -- non-uuid detail.user_id must yield NULL rather than a cast error.
     LEFT JOIN users ud ON ud.id = CASE
       WHEN a.detail->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN (a.detail->>'user_id')::uuid
     END
     WHERE a.tournament_id = $1
       AND ($2::uuid IS NULL OR (a.created_at, a.id) <
            (SELECT c.created_at, c.id FROM audit_log c WHERE c.id = $2))
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $3`,
    [tournamentId, opts.before ?? null, opts.limit + 1],
  );

  const page = rows.slice(0, opts.limit);
  const entries: AuditLogView[] = page.map(
    ({ ctx_round_number, ctx_table_number, ctx_player1_name, ctx_player2_name, ctx_player_name, ctx_user_name, ...entry }) => ({
      ...entry,
      context: {
        round_number: ctx_round_number,
        table_number: ctx_table_number,
        player1_name: ctx_player1_name,
        player2_name: ctx_player2_name,
        player_name: ctx_player_name,
        user_name: ctx_user_name,
      },
    }),
  );
  return {
    entries,
    next_cursor: rows.length > opts.limit ? page[page.length - 1]!.id : null,
  };
}
