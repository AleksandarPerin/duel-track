import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { EDITABLE_STATUSES } from '../tournaments/tournament.service';
import type { TournamentRegistrationView, RegistrationStatus, PublicTournamentInfo } from '@dueltrack/shared';

const REGISTRATION_COLUMNS = `
  tr.id, tr.tournament_id, tr.user_id, tr.guest_name, tr.guest_email,
  tr.status, tr.decided_by, tr.decided_at, tr.created_at,
  COALESCE(u.display_name, tr.guest_name) AS display_name
`;

async function getTournamentByToken(
  token: string,
): Promise<{ id: string; organizer_id: string; status: string } & PublicTournamentInfo> {
  const { rows } = await pool.query<
    { id: string; organizer_id: string; status: string } & PublicTournamentInfo
  >(
    `SELECT id, organizer_id, name, format, rel_level, venue, scheduled_at, status
     FROM tournaments WHERE registration_token = $1`,
    [token],
  );
  const tournament = rows[0];
  if (!tournament) throw new AppError('LINK_NOT_FOUND', 'Registration link is invalid');
  return tournament;
}

export async function getPublicTournamentInfo(token: string): Promise<PublicTournamentInfo> {
  const { id, name, format, rel_level, venue, scheduled_at, status } =
    await getTournamentByToken(token);
  return { id, name, format, rel_level, venue, scheduled_at, status };
}

export async function submitRegistration(
  token: string,
  actor: { userId: string } | null,
  guest: { guest_name?: string; guest_email?: string },
): Promise<TournamentRegistrationView> {
  const tournament = await getTournamentByToken(token);
  if (tournament.status !== 'registration') {
    throw new AppError('REGISTRATION_CLOSED', 'This tournament is not accepting registrations');
  }

  if (actor) {
    if (actor.userId === tournament.organizer_id) {
      throw new AppError('INVALID_REGISTRATION', 'The organizer cannot self-register');
    }

    // Mirror the same conflict-of-interest guard assignJudge() enforces in
    // the other direction: a judge who is also playing could self-report
    // their own match outcomes via enterResult().
    const { rows: existingJudge } = await pool.query(
      'SELECT 1 FROM tournament_judges WHERE tournament_id = $1 AND user_id = $2',
      [tournament.id, actor.userId],
    );
    if (existingJudge[0]) {
      throw new AppError('INVALID_REGISTRATION', 'A judge for this tournament cannot self-register as a player');
    }

    const { rows: existingPlayer } = await pool.query(
      'SELECT id FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
      [tournament.id, actor.userId],
    );
    if (existingPlayer[0]) {
      throw new AppError('ALREADY_PLAYER', 'You are already registered for this tournament');
    }

    try {
      const { rows } = await pool.query<TournamentRegistrationView>(
        `WITH ins AS (
           INSERT INTO tournament_registrations (tournament_id, user_id)
           VALUES ($1, $2)
           RETURNING id, tournament_id, user_id, guest_name, guest_email,
                     status, decided_by, decided_at, created_at
         )
         SELECT ins.*, u.display_name
         FROM ins JOIN users u ON u.id = ins.user_id`,
        [tournament.id, actor.userId],
      );
      const row = rows[0];
      if (!row) throw new Error('INSERT registration returned no rows');
      return row;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new AppError('ALREADY_REGISTERED', 'You already have a pending or approved registration');
      }
      throw err;
    }
  }

  const guestName = guest.guest_name;
  if (!guestName) {
    throw new AppError('GUEST_NAME_REQUIRED', 'guest_name is required when not logged in');
  }

  const { rows } = await pool.query<TournamentRegistrationView>(
    `INSERT INTO tournament_registrations (tournament_id, guest_name, guest_email)
     VALUES ($1, $2, $3)
     RETURNING id, tournament_id, user_id, guest_name, guest_email,
               status, decided_by, decided_at, created_at, guest_name AS display_name`,
    [tournament.id, guestName, guest.guest_email ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error('INSERT registration returned no rows');
  return row;
}

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
    throw new AppError('FORBIDDEN', 'Only the organizer can manage registrations');
  }
}

export async function listRegistrations(
  tournamentId: string,
  organizerId: string,
  status?: RegistrationStatus,
): Promise<TournamentRegistrationView[]> {
  await assertOrganizer(tournamentId, organizerId);

  const params: unknown[] = [tournamentId];
  let statusClause = '';
  if (status) {
    params.push(status);
    statusClause = `AND tr.status = $${params.length}`;
  }

  const { rows } = await pool.query<TournamentRegistrationView>(
    `SELECT ${REGISTRATION_COLUMNS}
     FROM tournament_registrations tr
     LEFT JOIN users u ON u.id = tr.user_id
     WHERE tr.tournament_id = $1 ${statusClause}
     ORDER BY tr.created_at`,
    params,
  );
  return rows;
}

export async function getRegistrationLink(
  tournamentId: string,
  organizerId: string,
): Promise<{ token: string }> {
  await assertOrganizer(tournamentId, organizerId);

  const { rows } = await pool.query<{ registration_token: string }>(
    'SELECT registration_token FROM tournaments WHERE id = $1',
    [tournamentId],
  );
  const row = rows[0];
  if (!row) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
  return { token: row.registration_token };
}

// Approving and rejecting both lock the registration row first so two
// concurrent decisions (e.g. a double-click) can't both proceed — critical
// for approval, which also inserts into tournament_players: without the
// lock, two concurrent approvals of the same *guest* registration could
// each pass the (nonexistent) guest uniqueness check and create two players
// for what was meant to be one person. addUserPlayer/addGuestPlayer aren't
// reused here because they run in their own separate transactions and can't
// be composed with this row lock atomically.
export async function decideRegistration(
  tournamentId: string,
  organizerId: string,
  registrationId: string,
  decision: 'approved' | 'rejected',
): Promise<TournamentRegistrationView> {
  await assertOrganizer(tournamentId, organizerId);

  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');

    const { rows: regRows } = await client.query<{
      id: string;
      user_id: string | null;
      guest_name: string | null;
      guest_email: string | null;
      status: string;
    }>(
      `SELECT id, user_id, guest_name, guest_email, status
       FROM tournament_registrations
       WHERE id = $1 AND tournament_id = $2
       FOR UPDATE`,
      [registrationId, tournamentId],
    );
    const registration = regRows[0];
    if (!registration) {
      throw new AppError('REGISTRATION_NOT_FOUND', 'Registration not found');
    }
    if (registration.status !== 'pending') {
      throw new AppError('REGISTRATION_ALREADY_DECIDED', 'This registration has already been decided');
    }

    if (decision === 'approved') {
      const { rows: tRows } = await client.query<{ status: string }>(
        'SELECT status FROM tournaments WHERE id = $1 FOR UPDATE',
        [tournamentId],
      );
      const tournament = tRows[0];
      if (!tournament || !EDITABLE_STATUSES.has(tournament.status)) {
        throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Cannot add players after tournament starts');
      }

      const { rows: seedRows } = await client.query<{ next_seed: string }>(
        `SELECT COALESCE(MAX(sort_seed), 0) + 1 AS next_seed
         FROM tournament_players WHERE tournament_id = $1`,
        [tournamentId],
      );
      const nextSeed = Number(seedRows[0]!.next_seed);

      // A SAVEPOINT is required here, not just a JS try/catch: once a query
      // inside a Postgres transaction errors, every subsequent command in
      // that same transaction (including the recovery UPDATE below, even
      // COMMIT itself) fails with "current transaction is aborted" until
      // either the whole transaction rolls back or it's rewound to a
      // savepoint — same technique importPlayersFromCsv uses per-row.
      await client.query('SAVEPOINT approve_insert');
      try {
        if (registration.user_id) {
          await client.query(
            `INSERT INTO tournament_players (tournament_id, user_id, sort_seed)
             VALUES ($1, $2, $3)`,
            [tournamentId, registration.user_id, nextSeed],
          );
        } else {
          await client.query(
            `INSERT INTO tournament_players (tournament_id, guest_name, guest_email, sort_seed)
             VALUES ($1, $2, $3, $4)`,
            [tournamentId, registration.guest_name, registration.guest_email, nextSeed],
          );
        }
        await client.query('RELEASE SAVEPOINT approve_insert');
      } catch (err: unknown) {
        if (isUniqueViolation(err)) {
          // The user was independently added as a player between submission
          // and decision (e.g. the organizer used POST /:id/players
          // directly). Approval can't proceed, but leaving the registration
          // stuck at 'pending' forever would wedge the queue with something
          // no future decision could ever resolve — rewind to the savepoint
          // (restoring the transaction to a usable state) and auto-resolve
          // it as 'rejected' instead.
          await client.query('ROLLBACK TO SAVEPOINT approve_insert');
          await client.query('RELEASE SAVEPOINT approve_insert');
          await client.query(
            `UPDATE tournament_registrations
             SET status = 'rejected', decided_by = $1, decided_at = NOW()
             WHERE id = $2`,
            [organizerId, registrationId],
          );
          await client.query('COMMIT');
          throw new AppError(
            'PLAYER_ALREADY_REGISTERED',
            'User is already registered in this tournament — the pending registration has been auto-rejected',
          );
        }
        throw err;
      }
    }

    const { rows: updated } = await client.query<TournamentRegistrationView>(
      `WITH upd AS (
         UPDATE tournament_registrations
         SET status = $1, decided_by = $2, decided_at = NOW()
         WHERE id = $3
         RETURNING id, tournament_id, user_id, guest_name, guest_email,
                   status, decided_by, decided_at, created_at
       )
       SELECT upd.*, COALESCE(u.display_name, upd.guest_name) AS display_name
       FROM upd LEFT JOIN users u ON u.id = upd.user_id`,
      [decision, organizerId, registrationId],
    );
    const result = updated[0];
    if (!result) throw new Error('UPDATE registration returned no rows');

    await client.query('COMMIT');
    return result;
  } catch (err) {
    originalError = err;
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      console.error('ROLLBACK failed in decideRegistration', e);
    }
    throw originalError;
  } finally {
    client.release();
  }
}
