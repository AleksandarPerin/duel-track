import { pool } from '../db/pool';
import { lockTournamentUserPair } from '../db/advisoryLock';
import { AppError } from '../errors/AppError';
import type { TournamentJudgeView } from '@dueltrack/shared';

async function assertOrganizer(tournamentId: string, organizerId: string): Promise<void> {
  const { rows } = await pool.query<{ organizer_id: string }>(
    'SELECT organizer_id FROM tournaments WHERE id = $1',
    [tournamentId],
  );
  const tournament = rows[0];
  if (!tournament) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can manage judges');
  }
}

export async function assignJudge(
  tournamentId: string,
  organizerId: string,
  targetUserId: string,
): Promise<TournamentJudgeView> {
  await assertOrganizer(tournamentId, organizerId);

  if (targetUserId === organizerId) {
    throw new AppError('INVALID_JUDGE', 'The organizer cannot be assigned as a judge');
  }

  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');
    // Serializes against claimGuestPlayer/linkPlayerToUser's own check for a
    // conflicting judge row — without this, a concurrent claim/link and this
    // assignment can each pass their own check before the other commits,
    // leaving the same user as both a player and a judge. See
    // lockTournamentUserPair's own comment for the full race.
    await lockTournamentUserPair(client, tournamentId, targetUserId);

    // A judge who is also competing has an obvious conflict of interest —
    // enterResult() lets judges self-report match outcomes, so a judge who is
    // one of the two players in their own pairing could report their own win.
    const { rows: playerRows } = await client.query(
      'SELECT id FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, targetUserId],
    );
    if (playerRows[0]) {
      throw new AppError('INVALID_JUDGE', 'A player registered in this tournament cannot be assigned as a judge');
    }

    const { rows: userRows } = await client.query<{ display_name: string; email: string }>(
      'SELECT display_name, email FROM users WHERE id = $1',
      [targetUserId],
    );
    const user = userRows[0];
    if (!user) throw new AppError('USER_NOT_FOUND', 'User not found');

    const { rows } = await client.query<{ tournament_id: string; user_id: string; assigned_by: string; created_at: string }>(
      `INSERT INTO tournament_judges (tournament_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id, user_id) DO NOTHING
       RETURNING tournament_id, user_id, assigned_by, created_at`,
      [tournamentId, targetUserId, organizerId],
    );
    const row = rows[0];
    if (!row) throw new AppError('JUDGE_ALREADY_ASSIGNED', 'User is already a judge for this tournament');

    await client.query('COMMIT');
    return { ...row, display_name: user.display_name, email: user.email };
  } catch (err) {
    originalError = err;
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      console.error('ROLLBACK failed in assignJudge', e);
    }
    throw originalError;
  } finally {
    client.release();
  }
}

export async function removeJudge(
  tournamentId: string,
  organizerId: string,
  targetUserId: string,
): Promise<void> {
  await assertOrganizer(tournamentId, organizerId);

  const { rowCount } = await pool.query(
    'DELETE FROM tournament_judges WHERE tournament_id = $1 AND user_id = $2',
    [tournamentId, targetUserId],
  );
  if (!rowCount) throw new AppError('JUDGE_NOT_FOUND', 'Judge not found for this tournament');
}

export async function listJudges(
  tournamentId: string,
  organizerId: string,
): Promise<TournamentJudgeView[]> {
  await assertOrganizer(tournamentId, organizerId);

  const { rows } = await pool.query<TournamentJudgeView>(
    `SELECT tj.tournament_id, tj.user_id, tj.assigned_by, tj.created_at,
            u.display_name, u.email
     FROM tournament_judges tj
     JOIN users u ON u.id = tj.user_id
     WHERE tj.tournament_id = $1
     ORDER BY tj.created_at`,
    [tournamentId],
  );
  return rows;
}
