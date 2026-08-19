import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { JWT_ISSUER, JWT_AUDIENCE } from '../auth/auth.types';
import type { ApiTokenSummary } from '@dueltrack/shared';

const API_TOKEN_EXPIRY_S = Number(process.env.API_TOKEN_EXPIRY_S ?? 31_536_000); // 365 days

export async function createApiToken(
  organizerId: string,
  label: string,
): Promise<{ id: string; label: string; created_at: string; token: string }> {
  const { rows } = await pool.query<{ id: string; created_at: string }>(
    `INSERT INTO api_tokens (organizer_id, label) VALUES ($1, $2) RETURNING id, created_at`,
    [organizerId, label],
  );
  const row = rows[0]!;
  const secret = process.env.JWT_SECRET!; // validated at buildApp() startup, same as auth.routes.ts
  const token = jwt.sign(
    { sub: organizerId, jti: row.id, type: 'api' },
    secret,
    { expiresIn: API_TOKEN_EXPIRY_S, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
  );
  return { id: row.id, label, created_at: row.created_at, token };
}

export async function listApiTokens(organizerId: string): Promise<ApiTokenSummary[]> {
  const { rows } = await pool.query<{
    id: string; label: string; created_at: string;
    last_used_at: string | null; revoked_at: string | null;
  }>(
    `SELECT id, label, created_at, last_used_at, revoked_at
     FROM api_tokens WHERE organizer_id = $1 ORDER BY created_at DESC`,
    [organizerId],
  );
  return rows.map(({ revoked_at, ...rest }) => ({ ...rest, revoked: revoked_at !== null }));
}

// Idempotent: revoking an already-revoked token is a silent no-op, not an error.
export async function revokeApiToken(tokenId: string, organizerId: string): Promise<void> {
  const { rows } = await pool.query<{ organizer_id: string; revoked_at: string | null }>(
    'SELECT organizer_id, revoked_at FROM api_tokens WHERE id = $1',
    [tokenId],
  );
  const row = rows[0];
  // Same 404 for "doesn't exist" and "exists but isn't yours" — don't let a
  // caller enumerate other organizers' token ids via a 403/404 split.
  if (!row || row.organizer_id !== organizerId) {
    throw new AppError('TOKEN_NOT_FOUND', 'API token not found');
  }
  if (row.revoked_at !== null) return;
  await pool.query('UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1', [tokenId]);
}
