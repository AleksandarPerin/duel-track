import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { CreateApiTokenSchema } from './api-tokens.schemas';
import { UUIDParamSchema } from '../tournaments/tournament.schemas';
import { createApiToken, listApiTokens, revokeApiToken } from './api-tokens.service';

const API_TOKEN_RATE_LIMIT = {
  max: Number(process.env.API_TOKEN_RATE_LIMIT_MAX ?? 30),
  timeWindow: Number(process.env.API_TOKEN_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

function parseId(value: string): string | null {
  const result = UUIDParamSchema.safeParse(value);
  return result.success ? result.data : null;
}

const apiTokensRoutes: FastifyPluginAsync = async (fastify) => {
  // POST / — create. Returns the signed JWT in the body exactly once; never
  // retrievable again afterward, only metadata via GET / from here on.
  fastify.post<{ Body: unknown }>('/', {
    config: { rateLimit: API_TOKEN_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const parsed = CreateApiTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }
      const result = await createApiToken(request.user!.id, parsed.data.label);
      return reply.code(201).send(result);
    },
  });

  // GET / — list caller's own tokens, metadata only, never the token itself.
  fastify.get('/', {
    config: { rateLimit: API_TOKEN_RATE_LIMIT },
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const tokens = await listApiTokens(request.user!.id);
      return reply.send({ tokens });
    },
  });

  // DELETE /:id — revoke, ownership-checked.
  fastify.delete<{ Params: { id: string } }>('/:id', {
    config: { rateLimit: API_TOKEN_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_PARAMS' });

      try {
        await revokeApiToken(id, request.user!.id);
      } catch (err) {
        if (err instanceof AppError && err.code === 'TOKEN_NOT_FOUND') {
          return reply.code(404).send({ error: 'TOKEN_NOT_FOUND' });
        }
        throw err;
      }
      return reply.send({ ok: true });
    },
  });
};

export default apiTokensRoutes;
