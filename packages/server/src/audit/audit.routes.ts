import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { listAuditLog } from './audit.service';

const AUDIT_RATE_LIMIT = {
  max: Number(process.env.AUDIT_RATE_LIMIT_MAX ?? 60),
  timeWindow: Number(process.env.AUDIT_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

const IdParamSchema = z.string().uuid();

const AuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().uuid().optional(),
  })
  .strict();

function handleError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    TOURNAMENT_NOT_FOUND: 404,
    FORBIDDEN: 403,
    INVALID_CURSOR: 400,
  };
  return reply.code(map[err.code] ?? 500).send({ error: err.code, message: err.message });
}

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  // Organizer-only, newest first; ?before=<entry id> pages to older entries.
  fastify.get<{ Params: { id: string }; Querystring: unknown }>('/:id/audit', {
    config: { rateLimit: AUDIT_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const id = IdParamSchema.safeParse(request.params.id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_ID' });

      const query = AuditQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: query.error.flatten() });
      }

      try {
        return reply.send(await listAuditLog(id.data, request.user!.id, query.data));
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });
};

export default auditRoutes;
