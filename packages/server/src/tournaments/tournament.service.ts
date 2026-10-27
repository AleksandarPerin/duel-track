import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { assertUserIsNotJudge } from '../judges/judgePlayerConflict';
import type { Tournament, TournamentPlayerView } from '@dueltrack/shared';
import type { CreateTournamentInput } from './tournament.schemas';

export const EDITABLE_STATUSES = new Set(['draft', 'registration']);

// ── Tournament CRUD ────────────────────────────────────────────────────────

export async function createTournament(
  organizerId: string,
  input: CreateTournamentInput,
): Promise<Tournament> {
  const { rows } = await pool.query<Tournament>(
    `INSERT INTO tournaments
       (organizer_id, name, format, rel_level, venue, scheduled_at, total_rounds, top_cut)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, organizer_id, name, format, rel_level, venue, scheduled_at,
               status, total_rounds, current_round, top_cut, created_at`,
    [
      organizerId,
      input.name,
      input.format,
      input.rel_level,
      input.venue ?? null,
      input.scheduled_at ?? null,
      input.total_rounds,
      input.top_cut,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('INSERT tournament returned no rows');
  return row;
}

export async function listOrganizerTournaments(organizerId: string): Promise<Tournament[]> {
  const { rows } = await pool.query<Tournament>(
    `SELECT id, organizer_id, name, format, rel_level, venue, scheduled_at,
            status, total_rounds, current_round, top_cut, created_at
     FROM tournaments WHERE organizer_id = $1 ORDER BY created_at DESC`,
    [organizerId],
  );
  return rows;
}

export async function getTournament(id: string): Promise<Tournament> {
  const { rows } = await pool.query<Tournament>(
    `SELECT id, organizer_id, name, format, rel_level, venue, scheduled_at,
            status, total_rounds, current_round, top_cut, created_at
     FROM tournaments WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
  return row;
}

// Read access for the authenticated-but-not-necessarily-organizer views
// (tournament detail, player roster, round pairings): the organizer or a
// judge assigned to this tournament may view it — everyone else gets
// FORBIDDEN. Deliberately separate from getTournament(), which many other
// service functions call internally and then apply their own (often
// stricter, organizer-only) check; this helper is only for the GET routes
// that were missing any ownership check at all.
export async function assertTournamentViewer(
  tournamentId: string,
  actorId: string,
): Promise<Tournament> {
  const tournament = await getTournament(tournamentId);
  if (tournament.organizer_id === actorId) return tournament;

  const { rows } = await pool.query(
    `SELECT 1 FROM tournament_judges WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, actorId],
  );
  if (rows.length === 0) {
    throw new AppError('FORBIDDEN', 'Only the tournament organizer or an assigned judge can view this tournament');
  }
  return tournament;
}

// The 'registration' status exists in the schema for exactly this: opening
// self-registration (Step 12) before the organizer starts the event. Only
// reachable from 'draft' — once players are being added/paired, going back
// isn't meaningful (startTournament already accepts 'draft' or
// 'registration' as valid starting states, so this step is optional).
export async function openRegistration(
  id: string,
  organizerId: string,
): Promise<Tournament> {
  const tournament = await getTournament(id);
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can open registration');
  }
  if (tournament.status !== 'draft') {
    throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Registration can only be opened from draft status');
  }

  const { rows } = await pool.query<Tournament>(
    `UPDATE tournaments SET status = 'registration' WHERE id = $1
     RETURNING id, organizer_id, name, format, rel_level, venue, scheduled_at,
               status, total_rounds, current_round, top_cut, created_at`,
    [id],
  );
  const updated = rows[0];
  if (!updated) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament was deleted concurrently');
  return updated;
}

// ── Player management ──────────────────────────────────────────────────────

// guest_email is intentionally excluded from the list view — it is PII and only
// the organizer needs it. Detailed player info can be fetched per-player if needed.
const PLAYER_COLUMNS = `
  tp.id, tp.tournament_id, tp.user_id, tp.sort_seed, tp.byes_received,
  tp.status, tp.drop_round, tp.created_at,
  COALESCE(u.display_name, tp.guest_name) AS display_name
`;

export async function listPlayers(
  tournamentId: string,
): Promise<TournamentPlayerView[]> {
  const { rows } = await pool.query<TournamentPlayerView>(
    `SELECT ${PLAYER_COLUMNS}
     FROM tournament_players tp
     LEFT JOIN users u ON u.id = tp.user_id
     WHERE tp.tournament_id = $1
     ORDER BY tp.sort_seed`,
    [tournamentId],
  );
  return rows;
}

type PlayerInsertFields =
  | { user_id: string }
  | { guest_name: string; guest_email?: string };

async function addPlayerInTransaction(
  tournamentId: string,
  fields: PlayerInsertFields,
): Promise<TournamentPlayerView> {
  const client = await pool.connect();
  let originalError: unknown = null;
  try {
    await client.query('BEGIN');
    // Before the tournament row lock — see assertUserIsNotJudge.
    if ('user_id' in fields) await assertUserIsNotJudge(client, tournamentId, fields.user_id);
    await client.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [tournamentId]);

    const { rows: seedRows } = await client.query<{ next_seed: string }>(
      `SELECT COALESCE(MAX(sort_seed), 0) + 1 AS next_seed
       FROM tournament_players WHERE tournament_id = $1`,
      [tournamentId],
    );
    const nextSeed = Number(seedRows[0]!.next_seed);

    let row: TournamentPlayerView;

    if ('user_id' in fields) {
      const { rows } = await client.query<TournamentPlayerView>(
        `INSERT INTO tournament_players (tournament_id, user_id, sort_seed)
         VALUES ($1, $2, $3)
         RETURNING ${PLAYER_COLUMNS.replace(/tp\./g, '').replace(/u\.display_name/g, 'NULL').replace(/ AS display_name/, '')},
           (SELECT display_name FROM users WHERE id = $2) AS display_name`,
        [tournamentId, fields.user_id, nextSeed],
      );
      if (!rows[0]) throw new Error('INSERT player returned no rows');
      row = rows[0];
    } else {
      const { rows } = await client.query<TournamentPlayerView>(
        `INSERT INTO tournament_players (tournament_id, guest_name, guest_email, sort_seed)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tournament_id, user_id, sort_seed, byes_received,
                   status, drop_round, created_at, guest_name AS display_name`,
        [tournamentId, fields.guest_name, fields.guest_email ?? null, nextSeed],
      );
      if (!rows[0]) throw new Error('INSERT player returned no rows');
      row = rows[0];
    }

    await client.query('COMMIT');
    return row;
  } catch (err: unknown) {
    originalError = err;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Log rollback failure but propagate the original error
      console.error('ROLLBACK failed after player insert error', rollbackErr);
    }
    if (
      originalError !== null &&
      typeof originalError === 'object' &&
      'code' in originalError &&
      (originalError as { code: string }).code === '23505'
    ) {
      throw new AppError('PLAYER_ALREADY_REGISTERED', 'User is already registered in this tournament');
    }
    throw originalError;
  } finally {
    client.release();
  }
}

export async function addUserPlayer(
  tournamentId: string,
  organizerId: string,
  userId: string,
): Promise<TournamentPlayerView> {
  const tournament = await getTournament(tournamentId);
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can add players');
  }
  if (!EDITABLE_STATUSES.has(tournament.status)) {
    throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Cannot add players after tournament starts');
  }

  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (!userRows[0]) throw new AppError('USER_NOT_FOUND', 'User not found');

  return addPlayerInTransaction(tournamentId, { user_id: userId });
}

export async function addGuestPlayer(
  tournamentId: string,
  organizerId: string,
  guestName: string,
  guestEmail?: string,
): Promise<TournamentPlayerView> {
  const tournament = await getTournament(tournamentId);
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can add players');
  }
  if (!EDITABLE_STATUSES.has(tournament.status)) {
    throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Cannot add players after tournament starts');
  }

  return addPlayerInTransaction(tournamentId, { guest_name: guestName, guest_email: guestEmail });
}

export async function removePlayer(
  tournamentId: string,
  playerId: string,
  organizerId: string,
): Promise<{ display_name: string | null }> {
  const tournament = await getTournament(tournamentId);
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can remove players');
  }
  if (!EDITABLE_STATUSES.has(tournament.status)) {
    throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Cannot remove players after tournament starts');
  }

  // Returns the name as it was at deletion, for the audit entry — the row is
  // gone afterwards, so the log can't look it up later.
  const { rows } = await pool.query<{ display_name: string | null }>(
    `DELETE FROM tournament_players tp WHERE tp.id = $1 AND tp.tournament_id = $2
     RETURNING COALESCE((SELECT u.display_name FROM users u WHERE u.id = tp.user_id), tp.guest_name) AS display_name`,
    [playerId, tournamentId],
  );
  if (!rows[0]) throw new AppError('PLAYER_NOT_FOUND', 'Player not found in this tournament');
  return rows[0];
}

export async function reorderSeeds(
  tournamentId: string,
  organizerId: string,
  seeds: Array<{ player_id: string; sort_seed: number }>,
): Promise<void> {
  const tournament = await getTournament(tournamentId);
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can reorder seeds');
  }
  if (!EDITABLE_STATUSES.has(tournament.status)) {
    throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Cannot reorder seeds after tournament starts');
  }

  const seedValues = seeds.map((s) => s.sort_seed);
  if (new Set(seedValues).size !== seedValues.length) {
    throw new AppError('DUPLICATE_SEEDS', 'Sort seed values must be unique');
  }

  const client = await pool.connect();
  let originalError: unknown = null;
  try {
    await client.query('BEGIN');
    // Lock the tournament row to serialize against concurrent player additions
    await client.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [tournamentId]);

    // Load all current player IDs; provided list must be an exact cover
    const { rows: currentRows } = await client.query<{ id: string }>(
      'SELECT id FROM tournament_players WHERE tournament_id = $1',
      [tournamentId],
    );
    const currentIds = new Set(currentRows.map((r) => r.id));
    const providedIds = new Set(seeds.map((s) => s.player_id));

    if (
      currentIds.size !== providedIds.size ||
      [...currentIds].some((id) => !providedIds.has(id))
    ) {
      throw new AppError(
        'INVALID_SEED_LIST',
        'Seed list must cover exactly all players in the tournament',
      );
    }

    for (const { player_id, sort_seed } of seeds) {
      await client.query(
        'UPDATE tournament_players SET sort_seed = $1 WHERE id = $2 AND tournament_id = $3',
        [sort_seed, player_id, tournamentId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    originalError = err;
    try { await client.query('ROLLBACK'); } catch (e) {
      console.error('ROLLBACK failed in reorderSeeds', e);
    }
    throw originalError;
  } finally {
    client.release();
  }
}
