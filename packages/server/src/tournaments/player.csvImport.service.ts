import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { EDITABLE_STATUSES, getTournament } from './tournament.service';

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
