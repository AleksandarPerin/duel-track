import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { toPlayerView, type GuestPlayerRow } from './profile.view';
import type { ClaimablePlayerView, TournamentPlayerView } from '@dueltrack/shared';

const CLAIMED_PLAYER_COLUMNS = `
  id, tournament_id, user_id, sort_seed, byes_received,
  status, drop_round, created_at
`;

// Discovery is bounded rather than paged: the length of this list is
// attacker-influenceable — anyone running a tournament can enter a guest row
// bearing someone else's address — so it must not be unbounded. No real
// player approaches 200 unclaimed guest entries.
const CLAIMABLE_LIMIT = 200;

function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}

async function assertOrganizer(tournamentId: string, organizerId: string): Promise<void> {
  const { rows } = await pool.query<{ organizer_id: string }>(
    'SELECT organizer_id FROM tournaments WHERE id = $1',
    [tournamentId],
  );
  const tournament = rows[0];
  if (!tournament) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can link player records');
  }
}

// The three NOT EXISTS / <> predicates mirror exactly what claimGuestPlayer
// rejects, so this returns the actionable set — nothing listed here can fail
// when the user actually claims it. Deliberately unfiltered by tournament
// status: claiming a completed or archived event is the point of the feature.
export async function listClaimablePlayers(userId: string): Promise<ClaimablePlayerView[]> {
  const { rows } = await pool.query<ClaimablePlayerView>(
    `SELECT tp.id           AS player_id,
            tp.tournament_id,
            t.name          AS tournament_name,
            t.status        AS tournament_status,
            t.scheduled_at,
            tp.guest_name,
            tp.status       AS player_status,
            tp.created_at
     FROM tournament_players tp
     JOIN tournaments t ON t.id = tp.tournament_id
     WHERE tp.user_id IS NULL
       AND tp.guest_email IS NOT NULL
       AND lower(tp.guest_email) = (SELECT email FROM users WHERE id = $1)
       AND t.organizer_id <> $1
       AND NOT EXISTS (
         SELECT 1 FROM tournament_players p2
         WHERE p2.tournament_id = tp.tournament_id AND p2.user_id = $1
       )
       AND NOT EXISTS (
         SELECT 1 FROM tournament_judges tj
         WHERE tj.tournament_id = tp.tournament_id AND tj.user_id = $1
       )
     ORDER BY t.scheduled_at DESC NULLS LAST, tp.created_at DESC
     LIMIT $2`,
    [userId, CLAIMABLE_LIMIT],
  );
  return rows;
}

export async function claimGuestPlayer(
  userId: string,
  playerId: string,
): Promise<{ player: TournamentPlayerView; claimed: boolean; guest_name: string | null }> {
  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');

    // Single-table lock with no JOIN — a joined FOR UPDATE would need `OF tp`.
    const { rows: playerRows } = await client.query<GuestPlayerRow>(
      `SELECT ${CLAIMED_PLAYER_COLUMNS}, guest_name, guest_email
       FROM tournament_players
       WHERE id = $1
       FOR UPDATE`,
      [playerId],
    );
    const player = playerRows[0];
    if (!player) throw new AppError('PLAYER_NOT_FOUND', 'Player record not found');

    // Read inside the transaction rather than before it: closes the TOCTOU
    // window should an email-change endpoint ever be added.
    const { rows: userRows } = await client.query<{ email: string; display_name: string }>(
      'SELECT email, display_name FROM users WHERE id = $1',
      [userId],
    );
    const user = userRows[0];
    if (!user) throw new Error('Authenticated user disappeared mid-request');

    if (player.user_id === userId) {
      await client.query('COMMIT');
      return {
        player: toPlayerView(player, user.display_name),
        claimed: false,
        guest_name: player.guest_name,
      };
    }

    // A row owned by someone else, a row that was never a guest row, and a row
    // whose email doesn't match are all reported identically — distinguishing
    // them would turn this route into an oracle for who played where.
    if (player.user_id !== null) {
      throw new AppError('PLAYER_NOT_FOUND', 'Player record not found');
    }
    if (!player.guest_email || player.guest_email.toLowerCase() !== user.email) {
      throw new AppError('PLAYER_NOT_FOUND', 'Player record not found');
    }

    const { rows: tournamentRows } = await client.query<{ organizer_id: string }>(
      'SELECT organizer_id FROM tournaments WHERE id = $1',
      [player.tournament_id],
    );
    if (tournamentRows[0]?.organizer_id === userId) {
      throw new AppError('INVALID_CLAIM', 'The organizer of a tournament cannot claim a player record in it');
    }

    // Same conflict of interest assignJudge() and submitRegistration() already
    // guard in the other two directions: judges can enter results for any
    // match, so a judge holding a player row could self-report their own wins.
    const { rows: judgeRows } = await client.query(
      'SELECT 1 FROM tournament_judges WHERE tournament_id = $1 AND user_id = $2',
      [player.tournament_id, userId],
    );
    if (judgeRows[0]) {
      throw new AppError('INVALID_CLAIM', 'A judge for this tournament cannot claim a player record in it');
    }

    const { rows: existingRows } = await client.query(
      'SELECT 1 FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
      [player.tournament_id, userId],
    );
    if (existingRows[0]) {
      throw new AppError('ALREADY_PLAYER', 'You already have a player record in this tournament');
    }

    const updated = await claimUpdate(client, playerId, userId, 'ALREADY_PLAYER');

    await client.query('COMMIT');
    return {
      player: { ...updated, display_name: user.display_name },
      claimed: true,
      guest_name: player.guest_name,
    };
  } catch (err) {
    originalError = err;
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      console.error('ROLLBACK failed in claimGuestPlayer', e);
    }
    throw originalError;
  } finally {
    client.release();
  }
}

export async function linkPlayerToUser(
  tournamentId: string,
  organizerId: string,
  playerId: string,
  targetUserId: string,
): Promise<{ player: TournamentPlayerView; guest_name: string | null }> {
  await assertOrganizer(tournamentId, organizerId);

  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');

    // Scoped by tournament_id in the lookup itself, never fetched globally and
    // compared afterwards — a valid player id from another tournament has to be
    // indistinguishable from one that doesn't exist.
    const { rows: playerRows } = await client.query<{
      id: string;
      tournament_id: string;
      user_id: string | null;
      guest_name: string | null;
    }>(
      `SELECT id, tournament_id, user_id, guest_name
       FROM tournament_players
       WHERE id = $1 AND tournament_id = $2
       FOR UPDATE`,
      [playerId, tournamentId],
    );
    const player = playerRows[0];
    if (!player) throw new AppError('PLAYER_NOT_FOUND', 'Player record not found');

    // Re-pointing an already-linked row would silently reattribute one
    // account's match history to another, so an organizer may only fill in a
    // link that is still empty.
    if (player.user_id !== null) {
      throw new AppError('PLAYER_ALREADY_LINKED', 'This player record is already linked to an account');
    }

    const { rows: userRows } = await client.query<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id = $1',
      [targetUserId],
    );
    const user = userRows[0];
    if (!user) throw new AppError('USER_NOT_FOUND', 'User not found');

    if (targetUserId === organizerId) {
      throw new AppError('INVALID_LINK', 'The organizer cannot be linked to a player record in their own tournament');
    }

    const { rows: judgeRows } = await client.query(
      'SELECT 1 FROM tournament_judges WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, targetUserId],
    );
    if (judgeRows[0]) {
      throw new AppError('INVALID_LINK', 'A judge for this tournament cannot be linked to a player record in it');
    }

    const { rows: existingRows } = await client.query(
      'SELECT 1 FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, targetUserId],
    );
    if (existingRows[0]) {
      throw new AppError('PLAYER_ALREADY_REGISTERED', 'That user already has a player record in this tournament');
    }

    const updated = await claimUpdate(client, playerId, targetUserId, 'PLAYER_ALREADY_REGISTERED');

    await client.query('COMMIT');
    return {
      player: { ...updated, display_name: user.display_name },
      guest_name: player.guest_name,
    };
  } catch (err) {
    originalError = err;
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      console.error('ROLLBACK failed in linkPlayerToUser', e);
    }
    throw originalError;
  } finally {
    client.release();
  }
}

// The row lock only serialises writers targeting the *same* row, so it can't
// stop one user claiming two different guest rows in the same tournament
// concurrently — both pass the pre-check and one lands here. The 23505 catch
// is the correctness backstop behind that pre-check, not a duplicate of it.
// No SAVEPOINT (unlike decideRegistration): nothing needs to run after the
// failed statement, so an ordinary ROLLBACK upstream is enough.
async function claimUpdate(
  client: import('pg').PoolClient,
  playerId: string,
  userId: string,
  conflictCode: 'ALREADY_PLAYER' | 'PLAYER_ALREADY_REGISTERED',
): Promise<TournamentPlayerView> {
  try {
    const { rows } = await client.query<TournamentPlayerView>(
      `UPDATE tournament_players
       SET user_id = $1
       WHERE id = $2 AND user_id IS NULL
       RETURNING ${CLAIMED_PLAYER_COLUMNS}`,
      [userId, playerId],
    );
    const updated = rows[0];
    if (!updated) throw new Error('UPDATE player returned no rows despite holding the row lock');
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(conflictCode, 'That user already has a player record in this tournament');
    }
    throw err;
  }
}
