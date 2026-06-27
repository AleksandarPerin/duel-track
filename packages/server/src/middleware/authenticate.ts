import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { AccessTokenPayloadSchema, JWT_ISSUER, JWT_AUDIENCE } from '../auth/auth.types';

// Fastify preHandler for all authenticated routes.
// Reads the access_token cookie, verifies signature + claims, validates payload
// shape with Zod, then checks token_version against the DB to detect revoked
// tokens (e.g. after logout).
//
// Phase 2 optimisation: cache token_version in Redis to eliminate the DB
// round-trip on every authenticated request.
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies?.access_token;
  if (!token) {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }

  // JWT_SECRET is validated at buildApp() startup — the assertion is safe here
  const secret = process.env.JWT_SECRET!;

  // Import lazily to avoid circular dependency at module init
  const { getUserById } = await import('../auth/auth.service.js');

  let raw: unknown;
  try {
    raw = jwt.verify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch {
    return reply.code(401).send({ error: 'INVALID_TOKEN' });
  }

  // Runtime shape validation — jwt.verify only guarantees signature/expiry/iss/aud
  const parsed = AccessTokenPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return reply.code(401).send({ error: 'INVALID_TOKEN' });
  }

  const { sub, role, tokenVersion } = parsed.data;
  const user = await getUserById(sub);
  if (!user || user.token_version !== tokenVersion) {
    return reply.code(401).send({ error: 'TOKEN_REVOKED' });
  }

  request.user = { id: sub, role, tokenVersion };
}
