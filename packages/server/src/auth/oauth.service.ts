import type { OAuth2Client } from 'google-auth-library';
import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import type { UserRow } from '@dueltrack/shared';

type SafeUserRow = Omit<UserRow, 'password_hash'>;

export interface GoogleProfile {
  email: string;
  displayName: string;
}

const MAX_DISPLAY_NAME_LEN = 100;

// Mirrors RegisterSchema's display_name transform (auth.schemas.ts) so every
// stored display_name shares the same normalization/length invariant,
// regardless of which login path created the account. Unlike registration,
// a Google login can't be rejected for an overlong name — there's no form
// for the user to fix — so this truncates rather than validates. Truncating
// via Array.from (codepoint-aware) rather than String.slice (UTF-16 code
// units) avoids splitting a surrogate pair or separating a base character
// from a trailing combining mark at the cut point.
function normalizeDisplayName(raw: string): string {
  const normalized = raw.trim().normalize('NFC');
  return Array.from(normalized).slice(0, MAX_DISPLAY_NAME_LEN).join('');
}

// Verifies the ID token's signature against Google's published JWKS (handled
// internally by google-auth-library, including key caching/rotation) and
// checks issuer/audience/expiry. Only a verified email is trusted enough to
// link/create a local account — an unverified email on the Google side could
// belong to someone else.
export async function verifyGoogleIdToken(
  client: OAuth2Client,
  idToken: string,
  clientId: string,
): Promise<GoogleProfile> {
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new AppError('OAUTH_EMAIL_UNVERIFIED', 'Google account email is not verified');
  }
  const rawName = payload.name?.trim() || payload.email.split('@')[0]!;
  return {
    email: payload.email.toLowerCase(),
    displayName: normalizeDisplayName(rawName),
  };
}

const SAFE_USER_COLUMNS = 'id, email, display_name, role, token_version, profile_public, created_at';

// A verified Google email proves the caller controls that mailbox, but NOT
// that they own a pre-existing DuelTrack account with the same email — that
// account could have been registered by anyone via POST /register, which
// requires no email ownership proof. Auto-linking to a password-protected
// account would let an attacker pre-register a victim's email, then silently
// receive the victim's Google-authenticated session once they log in
// ("pre-hijacking"). So a Google login only ever attaches to a NEW user or an
// existing account that is already password-less (itself OAuth-created).
function assertLinkable(existing: UserRow): SafeUserRow {
  if (existing.password_hash !== null) {
    throw new AppError(
      'OAUTH_ACCOUNT_EXISTS',
      'An account with this email already exists. Log in with your password instead.',
    );
  }
  const { password_hash: _omit, ...safe } = existing;
  return safe;
}

export async function findOrCreateOAuthUser(
  email: string,
  displayName: string,
): Promise<SafeUserRow> {
  const { rows: existing } = await pool.query<UserRow>(
    `SELECT id, email, display_name, password_hash, role, token_version, profile_public, created_at
     FROM users WHERE email = $1`,
    [email],
  );
  if (existing[0]) return assertLinkable(existing[0]);

  // Rely on the UNIQUE constraint to resolve a concurrent registration race
  // rather than a pre-check SELECT (same approach as registerUser).
  const { rows: inserted } = await pool.query<SafeUserRow>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, NULL)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${SAFE_USER_COLUMNS}`,
    [email, displayName],
  );
  if (inserted[0]) return inserted[0];

  // Lost the insert race — re-fetch and re-apply the same linkability check,
  // since the row that won the race could in principle be a password account
  // created in the same instant.
  const { rows: retry } = await pool.query<UserRow>(
    `SELECT id, email, display_name, password_hash, role, token_version, profile_public, created_at
     FROM users WHERE email = $1`,
    [email],
  );
  const user = retry[0];
  if (!user) throw new Error('OAuth user lookup failed after insert conflict');
  return assertLinkable(user);
}
