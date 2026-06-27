import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import type { UserRow } from '@dueltrack/shared';

type SafeUserRow = Omit<UserRow, 'password_hash'>;

// Read rounds lazily per-call so the env var is consumed after app startup,
// and always enforce the PRD minimum of 12 (§6.1).
function getBcryptRounds(): number {
  return Math.max(12, Number(process.env.BCRYPT_ROUNDS ?? 12));
}

// Initialized once on first use (avoids blocking the event loop at module import
// time and respects late env-var loading by dotenv / secret managers).
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash('dueltrack-dummy-sentinel', getBcryptRounds());
  }
  return dummyHashPromise;
}

export async function registerUser(
  email: string,
  displayName: string,
  password: string,
): Promise<SafeUserRow> {
  const passwordHash = await bcrypt.hash(password, getBcryptRounds());

  // Rely on the DB UNIQUE constraint (no pre-check SELECT to avoid TOCTOU).
  // pg error code 23505 = unique_violation.
  let rows: SafeUserRow[];
  try {
    ({ rows } = await pool.query<SafeUserRow>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, role, token_version, profile_public, created_at`,
      [email, displayName, passwordHash],
    ));
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw new AppError('EMAIL_TAKEN', 'Email already registered');
    }
    throw err;
  }

  const user = rows[0];
  if (!user) throw new Error('INSERT returned no rows — unexpected DB state');
  return user;
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SafeUserRow> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, display_name, password_hash, role, token_version, profile_public, created_at
     FROM users WHERE email = $1`,
    [email],
  );

  const user = rows[0];
  // Always run bcrypt regardless of whether the user exists or has a password,
  // preventing email enumeration via response-time differences.
  const hash = user?.password_hash ?? (await getDummyHash());
  const valid = await bcrypt.compare(password, hash);

  if (!valid || !user || !user.password_hash) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const { password_hash: _omit, ...safeUser } = user;
  return safeUser;
}

export async function getUserById(id: string): Promise<SafeUserRow | null> {
  const { rows } = await pool.query<SafeUserRow>(
    `SELECT id, email, display_name, role, token_version, profile_public, created_at
     FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function incrementTokenVersion(userId: string): Promise<void> {
  await pool.query(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1',
    [userId],
  );
}
