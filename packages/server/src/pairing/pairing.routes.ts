import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from '../audit/audit.service';
import { startTournament, getRoundPairings, advanceRound, forceAdvanceRound } from './pairing.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

function handleError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    TOURNAMENT_NOT_FOUND: 404,
    ROUND_NOT_FOUND: 404,
    FORBIDDEN: 403,
    TOURNAMENT_NOT_STARTABLE: 409,
    INSUFFICIENT_PLAYERS: 422,
    TOURNAMENT_NOT_IN_PROGRESS: 409,
    ROUND_NOT_ACTIVE: 409,
    RESULTS_INCOMPLETE: 422,
    PLAYER_NOT_ACTIVE: 422,
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

const pairingRoutes: FastifyPluginAsync = async (fastify) => {
  // Start tournament and generate round 1 pairings
  fastify.post<{ Params: { id: string } }>('/:id/start', {
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        const result = await startTournament(id, user.id);

        await safeAudit(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'tournament.started',
          entityType: 'round',
          entityId: result.round.id,
          detail: {
            round_number: result.round.round_number,
            player_count: result.pairings.length,
            bye_present: result.pairings.some((p) => p.is_bye),
            warning: result.warning ?? null,
          },
        });

        return reply.code(201).send(result);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  // Advance to the next round (close current round, compute standings, generate next pairings)
  fastify.post<{ Params: { id: string } }>('/:id/advance', {
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        const result = await advanceRound(id, user.id);

        if (result.completed) {
          await safeAudit(request.log, {
            tournamentId: id,
            actorId: user.id,
            action: 'round.completed',
            entityType: 'tournament',
            entityId: id,
            detail: { final_round: result.roundNumber, tournament_completed: true },
          });
          return reply.send({ completed: true, round_number: result.roundNumber });
        }

        await safeAudit(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'round.completed',
          entityType: 'round',
          entityId: result.round.id,
          detail: {
            round_number: result.round.round_number,
            player_count: result.pairings.length,
            bye_present: result.pairings.some((p) => p.is_bye),
            warning: result.warning ?? null,
          },
        });

        return reply.code(201).send(result);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  // Force-advance: auto-enter double_loss for all incomplete pairings, then advance
  fastify.post<{ Params: { id: string }; Body: unknown }>('/:id/force-advance', {
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const body = request.body as { reason?: string; responsible_player_ids?: unknown } | null;
      const reason = typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : null;
      if (!reason) {
        return reply.code(400).send({ error: 'REASON_REQUIRED', message: 'A reason is required to force-advance a round' });
      }
      const responsible = Array.isArray(body?.responsible_player_ids)
        ? (body!.responsible_player_ids as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];

      const user = request.user!;
      try {
        const result = await forceAdvanceRound(id, user.id, responsible);

        const detail = result.completed
          ? { final_round: result.roundNumber, tournament_completed: true, forced_results: result.forced_results, reason }
          : {
              round_number: result.round.round_number,
              player_count: result.pairings.length,
              forced_results: result.forced_results,
              reason,
              warning: result.warning ?? null,
            };

        await safeAudit(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'round.force_advanced',
          entityType: result.completed ? 'tournament' : 'round',
          entityId: result.completed ? id : result.round.id,
          detail,
        });

        return reply.code(result.completed ? 200 : 201).send(result);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  // Get pairings for a specific round
  fastify.get<{ Params: { id: string; roundNumber: string } }>(
    '/:id/rounds/:roundNumber/pairings',
    {
      preHandler: authenticate,
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const rn = parseInt(request.params.roundNumber, 10);
        if (!id || isNaN(rn) || rn < 1) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }

        try {
          const data = await getRoundPairings(id, rn);
          if (!data) return reply.code(404).send({ error: 'ROUND_NOT_FOUND' });
          return reply.send(data);
        } catch (err) {
          return handleError(err, reply);
        }
      },
    },
  );
};

export default pairingRoutes;
