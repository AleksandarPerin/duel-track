import type { PoolClient } from 'pg';
import { lockTournamentUserPair } from '../db/advisoryLock';
import { AppError } from '../errors/AppError';

// For paths that make a registered user a player (organizer add, approving a
// self-registration): refuses a user who is a judge of the tournament. Judges
// can enter any result, so a judge who also plays could report their own
// match. Takes the same advisory lock as assignJudge(), so a concurrent judge
// assignment cannot pass its own check before this insert commits. Must run
// inside a transaction on `client`, before the player row is inserted and
// before any lock on the tournaments row: assignJudge holds the advisory lock
// while its tournament_judges insert takes a key-share lock on that row, so
// the opposite order deadlocks.
export async function assertUserIsNotJudge(
  client: PoolClient,
  tournamentId: string,
  userId: string,
): Promise<void> {
  await lockTournamentUserPair(client, tournamentId, userId);
  const { rows } = await client.query(
    'SELECT 1 FROM tournament_judges WHERE tournament_id = $1 AND user_id = $2',
    [tournamentId, userId],
  );
  if (rows[0]) {
    throw new AppError('PLAYER_IS_JUDGE', 'A judge for this tournament cannot also be a player in it');
  }
}
