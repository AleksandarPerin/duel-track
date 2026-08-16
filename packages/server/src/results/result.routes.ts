import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from '../audit/audit.service';
import { enterResult } from './result.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

function handleError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    PAIRING_NOT_FOUND: 404,
    TOURNAMENT_NOT_IN_PROGRESS: 409,
    BYE_RESULT: 422,
    RESULT_ALREADY_ENTERED: 409,
    FORBIDDEN: 403,
  };
  return reply.code(map[err.code] ?? 500).send({ error: err.code, message: err.message });
}

const ResultInputSchema = z.object({
  player1_game_wins: z.number().int().min(0).max(2),
  player2_game_wins: z.number().int().min(0).max(2),
  games_drawn: z.number().int().min(0).max(1).default(0),
  outcome: z.enum(['player1_win', 'player2_win', 'draw', 'intentional_draw', 'double_loss']),
}).superRefine((d, ctx) => {
  const { outcome: o, player1_game_wins: p1, player2_game_wins: p2, games_drawn: gd } = d;
  const valid =
    (o === 'intentional_draw' || o === 'double_loss')
      ? p1 === 0 && p2 === 0 && gd === 0
    : o === 'player1_win'
      ? p1 === 2 && (p2 === 0 || p2 === 1) && gd === 0
    : o === 'player2_win'
      ? p2 === 2 && (p1 === 0 || p1 === 1) && gd === 0
    : o === 'draw'
      ? p1 === 1 && p2 === 1 && gd === 1
    : false;
  if (!valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Game counts are inconsistent with outcome' });
  }
});

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

const resultRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { id: string; pairingId: string } }>(
    '/:id/pairings/:pairingId/result',
    {
      preHandler: [authenticate, fastify.csrfProtection],
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const pairingId = parseUUID(request.params.pairingId);
        if (!id || !pairingId) return reply.code(400).send({ error: 'INVALID_PARAMS' });

        const parsed = ResultInputSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'INVALID_BODY', details: parsed.error.flatten() });
        }

        const user = request.user!;
        try {
          const result = await enterResult(id, pairingId, parsed.data, user.id);

          await safeAudit(request.log, {
            tournamentId: id,
            actorId: user.id,
            action: 'result.entered',
            entityType: 'result',
            entityId: result.id,
            detail: {
              pairing_id: pairingId,
              outcome: result.outcome,
              player1_game_wins: result.player1_game_wins,
              player2_game_wins: result.player2_game_wins,
              games_drawn: result.games_drawn,
            },
          });

          return reply.code(201).send(result);
        } catch (err) {
          return handleError(err, reply);
        }
      },
    },
  );
};

export default resultRoutes;
