import type { PoolClient } from 'pg';

// Serializes concurrent check-then-act sequences for the same (tournament,
// user) pair across otherwise-independent code paths (e.g. assigning a judge
// vs. claiming/linking a player record) that each individually check "is
// this user already the other role?" — without this, two such sequences can
// interleave so that neither's check sees the other's not-yet-committed
// write, letting a user end up as both a player and a judge in the same
// tournament. Lock order, everywhere: this advisory lock first, then the
// tournaments row, then tournament_players rows. assignJudge's
// tournament_judges insert takes a key-share lock on the tournaments row while
// holding this lock, and reorderSeeds/pairing/drop lock the tournaments row
// and then player rows, so taking this lock after either row lock can
// deadlock. (decideRegistration locks its tournament_registrations row before
// this lock; that is safe only because nothing holding this lock waits on a
// registration row — keep it that way.) Must be called inside an existing
// transaction on `client`;
// pg_advisory_xact_lock auto-releases at COMMIT/ROLLBACK, so callers don't
// need to unlock explicitly.
//
// Two int4 keys (rather than a single bigint hash of the concatenated ids)
// avoids collision with any unrelated advisory lock elsewhere in the app —
// the first key namespaces this lock family, the second is the pair itself.
export async function lockTournamentUserPair(
  client: PoolClient,
  tournamentId: string,
  userId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
    'judge-player-conflict',
    `${tournamentId}:${userId}`,
  ]);
}
