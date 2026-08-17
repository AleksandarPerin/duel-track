import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from '../audit/audit.service';
import { AssignJudgeSchema } from './judge.schemas';
import { assignJudge, removeJudge, listJudges } from './judge.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

const JUDGE_RATE_LIMIT = {
  max: Number(process.env.JUDGE_RATE_LIMIT_MAX ?? 30),
  timeWindow: Number(process.env.JUDGE_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

function handleError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    TOURNAMENT_NOT_FOUND: 404,
    USER_NOT_FOUND: 404,
    JUDGE_NOT_FOUND: 404,
    FORBIDDEN: 403,
    INVALID_JUDGE: 422,
    JUDGE_ALREADY_ASSIGNED: 409,
  };
  return reply.code(map[err.code] ?? 500).send({ error: err.code, message: err.message });
}

async function safeAudit(
  log: import('fastify').FastifyBaseLogger,
  params: Parameters<typeof writeAuditLog>[0],
): Promise<void> {
  try {
    await writeAuditLog(params);
  } catch (err) {
    log.error({ err }, 'Failed to write audit log — mutation was committed');
  }
}

const judgeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>('/:id/judges', {
    config: { rateLimit: JUDGE_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        return reply.send(await listJudges(id, user.id));
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  fastify.post<{ Params: { id: string }; Body: unknown }>('/:id/judges', {
    config: { rateLimit: JUDGE_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const parsed = AssignJudgeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const user = request.user!;
      try {
        const judge = await assignJudge(id, user.id, parsed.data.user_id);

        await safeAudit(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'judge.assigned',
          entityType: 'tournament_judge',
          entityId: judge.user_id,
          detail: { user_id: judge.user_id },
        });

        return reply.code(201).send(judge);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  fastify.delete<{ Params: { id: string; userId: string } }>('/:id/judges/:userId', {
    config: { rateLimit: JUDGE_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      const userId = parseUUID(request.params.userId);
      if (!id || !userId) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        await removeJudge(id, user.id, userId);

        await safeAudit(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'judge.removed',
          entityType: 'tournament_judge',
          entityId: userId,
          detail: { user_id: userId },
        });

        return reply.code(204).send();
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });
};

export default judgeRoutes;
