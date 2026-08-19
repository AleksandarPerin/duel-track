import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { ApiTokenPayloadSchema, JWT_ISSUER, JWT_AUDIENCE } from '../auth/auth.types';

const BEARER_RE = /^Bearer (.+)$/;

export async function authenticateApiToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  const match = header ? BEARER_RE.exec(header) : null;
  if (!match) {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
  const token = match[1]!;
  const secret = process.env.JWT_SECRET!; // same secret as session access tokens — fine, `type` discriminates

  let raw: unknown;
  try {
    raw = jwt.verify(token, secret, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  } catch {
    return reply.code(401).send({ error: 'INVALID_TOKEN' });
  }

  const parsed = ApiTokenPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return reply.code(401).send({ error: 'INVALID_TOKEN' });
  }

  const { sub, jti } = parsed.data;
  const { rows } = await pool.query<{ revoked_at: string | null }>(
    'SELECT revoked_at FROM api_tokens WHERE id = $1 AND organizer_id = $2',
    [jti, sub],
  );
  const row = rows[0];
  if (!row || row.revoked_at !== null) {
    return reply.code(401).send({ error: 'TOKEN_REVOKED' });
  }

  // Best-effort, fire-and-forget — must not add latency or a failure mode to
  // every external API call just to update a "last used" timestamp.
  void pool.query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [jti]).catch((err) => {
    request.log.error({ err }, 'Failed to update api_tokens.last_used_at');
  });

  request.apiToken = { organizerId: sub, tokenId: jti };
}
