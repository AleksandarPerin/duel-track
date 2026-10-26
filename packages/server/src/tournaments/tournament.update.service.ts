import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import type { Tournament } from '@dueltrack/shared';
import type { UpdateTournamentInput } from './tournament.schemas';
import { writeAuditLog } from '../audit/audit.service';
import { EDITABLE_STATUSES } from './tournament.service';

export async function updateTournament(
  id: string,
  organizerId: string,
  input: UpdateTournamentInput,
): Promise<{
  tournament: Tournament;
  changed: boolean;
  changedFields: Partial<UpdateTournamentInput>;
  // Set when the audit entry couldn't be written; the edit itself still
  // committed (best-effort, same as every other audit write). Caller logs it.
  auditError?: unknown;
}> {
  // Compare-then-write under a row lock: the comparison decides what the
  // audit log says changed, so two concurrent identical edits must not both
  // see the old value and each log a change.
  const client = await pool.connect();
  let brokenConnection: unknown;
  try {
    await client.query('BEGIN');
    const { rows: current } = await client.query<Tournament>(
      `SELECT id, organizer_id, name, format, rel_level, venue, scheduled_at,
              status, total_rounds, current_round, top_cut, created_at
       FROM tournaments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const tournament = current[0];
    if (!tournament) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    if (tournament.organizer_id !== organizerId) {
      throw new AppError('FORBIDDEN', 'Only the organizer can modify this tournament');
    }
    if (!EDITABLE_STATUSES.has(tournament.status)) {
      throw new AppError(
        'TOURNAMENT_NOT_EDITABLE',
        `Tournament cannot be modified in status "${tournament.status}"`,
      );
    }

    // Only fields whose value actually differs from the stored row: a form
    // that resubmits every field shouldn't make the audit log claim it
    // changed all of them. scheduled_at is compared as an instant, since the
    // stored value and the submitted ISO string can spell the same time
    // differently.
    const toTime = (v: unknown) => (v == null ? null : new Date(v as string).getTime());
    const changedFields: Partial<UpdateTournamentInput> = {};
    if (input.name !== undefined && input.name !== tournament.name) changedFields.name = input.name;
    if (input.venue !== undefined && (input.venue ?? null) !== (tournament.venue ?? null)) {
      changedFields.venue = input.venue;
    }
    if (input.scheduled_at !== undefined && toTime(input.scheduled_at) !== toTime(tournament.scheduled_at)) {
      changedFields.scheduled_at = input.scheduled_at;
    }

    // Column names go into the SQL text, so they come from this fixed map —
    // never from the keys of an object that could one day carry client input.
    const COLUMNS = { name: 'name', venue: 'venue', scheduled_at: 'scheduled_at' } as const;
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
      if (!(key in changedFields)) continue;
      updates.push(`${COLUMNS[key]} = $${idx++}`);
      values.push(changedFields[key]);
    }

    if (updates.length === 0) {
      await client.query('COMMIT');
      return { tournament, changed: false, changedFields };
    }

    values.push(id);
    const { rows } = await client.query<Tournament>(
      `UPDATE tournaments SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, organizer_id, name, format, rel_level, venue, scheduled_at,
                 status, total_rounds, current_round, top_cut, created_at`,
      values,
    );

    // Audit entry inside the same transaction, so entries for concurrent
    // different edits are ordered like the edits themselves. A savepoint
    // keeps a failed audit insert from rolling back the edit. (Losing the
    // connection mid-insert still fails the whole request — nothing commits
    // then, which is the right outcome.)
    let auditError: unknown;
    await client.query('SAVEPOINT audit');
    try {
      await writeAuditLog(
        {
          tournamentId: id,
          actorId: organizerId,
          action: 'tournament.updated',
          entityType: 'tournament',
          entityId: id,
          detail: changedFields as Record<string, unknown>,
        },
        client,
      );
      await client.query('RELEASE SAVEPOINT audit');
    } catch (err) {
      auditError = err;
      await client.query('ROLLBACK TO SAVEPOINT audit');
    }

    await client.query('COMMIT');
    return { tournament: rows[0]!, changed: true, changedFields, auditError };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      console.error('ROLLBACK failed in updateTournament', e);
      // The connection itself is broken — destroy it rather than hand it
      // back to the pool for the next request to fail on.
      brokenConnection = e;
    }
    throw err;
  } finally {
    client.release(brokenConnection !== undefined);
  }
}
