import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import type { Tournament, TournamentPlayerView } from '@dueltrack/shared';
import type { CreateTournamentInput, UpdateTournamentInput } from './tournament.schemas';

export const EDITABLE_STATUSES = new Set(['draft', 'registration']);
const MAX_CSV_PLAYERS = 512;

// ── RFC 4180 CSV parser ────────────────────────────────────────────────────
// Handles quoted fields, escaped quotes (""), CRLF and LF line endings.
// Does NOT handle fields with embedded newlines (not needed for player names).

function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < row.length) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        inQuotes = false;
        i++;
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      fields.push(field.trim());
      field = '';
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  fields.push(field.trim());
  return fields;
}

function parseCsv(text: string): Array<{ display_name: string; guest_email?: string }> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new AppError('INVALID_CSV', 'CSV must have a header row and at least one data row');
  }

  const header = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const nameIdx = header.indexOf('display_name');
  const emailIdx = header.indexOf('guest_email');

  if (nameIdx === -1) {
    throw new AppError('INVALID_CSV', 'CSV must contain a "display_name" column');
  }

  const dataLines = lines.slice(1).filter((l) => l.trim() !== '');
  if (dataLines.length > MAX_CSV_PLAYERS) {
    throw new AppError('CSV_TOO_LARGE', `CSV may not exceed ${MAX_CSV_PLAYERS} rows`);
  }

  return dataLines.map((line) => {
    const cols = parseCsvRow(line);
    const raw = cols[nameIdx] ?? '';
    const name = raw.normalize('NFC').trim();
    const rawEmail = emailIdx >= 0 ? (cols[emailIdx] ?? '') : '';
    const email = rawEmail.trim().toLowerCase();
    return {
      display_name: name,
      guest_email: email || undefined,
    };
  });
}

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

export async function updateTournament(
  id: string,
  organizerId: string,
  input: UpdateTournamentInput,
): Promise<{ tournament: Tournament; changed: boolean }> {
  const tournament = await getTournament(id);

  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can modify this tournament');
  }
  if (!EDITABLE_STATUSES.has(tournament.status)) {
    throw new AppError(
      'TOURNAMENT_NOT_EDITABLE',
      `Tournament cannot be modified in status "${tournament.status}"`,
    );
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) { updates.push(`name = $${idx++}`); values.push(input.name); }
  if (input.venue !== undefined) { updates.push(`venue = $${idx++}`); values.push(input.venue); }
  if (input.scheduled_at !== undefined) { updates.push(`scheduled_at = $${idx++}`); values.push(input.scheduled_at); }

  if (updates.length === 0) return { tournament, changed: false };

  values.push(id);
  const { rows } = await pool.query<Tournament>(
    `UPDATE tournaments SET ${updates.join(', ')} WHERE id = $${idx}
     RETURNING id, organizer_id, name, format, rel_level, venue, scheduled_at,
               status, total_rounds, current_round, top_cut, created_at`,
    values,
  );
  const updated = rows[0];
  if (!updated) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament was deleted concurrently');
  return { tournament: updated, changed: true };
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
): Promise<void> {
  const tournament = await getTournament(tournamentId);
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can remove players');
  }
  if (!EDITABLE_STATUSES.has(tournament.status)) {
    throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Cannot remove players after tournament starts');
  }

  const { rowCount } = await pool.query(
    'DELETE FROM tournament_players WHERE id = $1 AND tournament_id = $2',
    [playerId, tournamentId],
  );
  if (!rowCount) throw new AppError('PLAYER_NOT_FOUND', 'Player not found in this tournament');
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

// ── CSV import ─────────────────────────────────────────────────────────────

export interface CsvImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export async function importPlayersFromCsv(
  tournamentId: string,
  organizerId: string,
  csvText: string,
): Promise<CsvImportResult> {
  const tournament = await getTournament(tournamentId);
  if (tournament.organizer_id !== organizerId) {
    throw new AppError('FORBIDDEN', 'Only the organizer can import players');
  }
  if (!EDITABLE_STATUSES.has(tournament.status)) {
    throw new AppError('TOURNAMENT_NOT_EDITABLE', 'Cannot import players after tournament starts');
  }

  const rows = parseCsv(csvText);
  const result: CsvImportResult = { imported: 0, skipped: 0, errors: [] };

  // Validate all rows up-front before touching the database
  const validRows: Array<{ display_name: string; guest_email?: string }> = [];
  // Deduplicate within this batch by normalised display_name
  const seenNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const { display_name, guest_email } = rows[i]!;
    const trimmedName = display_name.trim();

    if (!trimmedName) {
      result.errors.push({ row: rowNum, message: 'display_name is required' });
      continue;
    }
    if (trimmedName.length > 100) {
      result.errors.push({ row: rowNum, message: 'display_name exceeds 100 characters' });
      continue;
    }
    if (guest_email) {
      // Basic email format check (same constraint as AddPlayerSchema)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) {
        result.errors.push({ row: rowNum, message: 'guest_email is not a valid email address' });
        continue;
      }
    }

    const nameKey = trimmedName.toLowerCase();
    if (seenNames.has(nameKey)) {
      result.skipped++;
      continue;
    }
    seenNames.add(nameKey);
    validRows.push({ display_name: trimmedName.normalize('NFC'), guest_email });
  }

  if (validRows.length === 0) return result;

  // Insert all valid rows in a single transaction with savepoints so individual
  // failures (e.g. re-importing an already-registered guest) don't abort the batch.
  const client = await pool.connect();
  let originalError: unknown = null;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [tournamentId]);

    const { rows: seedRows } = await client.query<{ next_seed: string }>(
      `SELECT COALESCE(MAX(sort_seed), 0) + 1 AS next_seed
       FROM tournament_players WHERE tournament_id = $1`,
      [tournamentId],
    );
    let nextSeed = Number(seedRows[0]!.next_seed);

    for (let i = 0; i < validRows.length; i++) {
      const { display_name, guest_email } = validRows[i]!;
      const sp = `csv_row_${i}`;
      try {
        await client.query(`SAVEPOINT ${sp}`);
        await client.query(
          `INSERT INTO tournament_players (tournament_id, guest_name, guest_email, sort_seed)
           VALUES ($1, $2, $3, $4)`,
          [tournamentId, display_name, guest_email ?? null, nextSeed++],
        );
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        result.imported++;
      } catch (rowErr) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        nextSeed--; // reclaim the seed not consumed
        result.skipped++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    originalError = err;
    try { await client.query('ROLLBACK'); } catch (e) {
      console.error('ROLLBACK failed in importPlayersFromCsv', e);
    }
    throw originalError;
  } finally {
    client.release();
  }

  return result;
}
