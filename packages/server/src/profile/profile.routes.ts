import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from '../audit/audit.service';
import { ClaimPlayerSchema, LinkPlayerSchema } from './profile.schemas';
import {
  listClaimablePlayers,
  claimGuestPlayer,
  linkPlayerToUser,
  getHeadToHead,
} from './profile.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

const CLAIM_RATE_LIMIT = {
  max: Number(process.env.CLAIM_RATE_LIMIT_MAX ?? 30),
  timeWindow: Number(process.env.CLAIM_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

const HEAD_TO_HEAD_RATE_LIMIT = {
  max: Number(process.env.HEAD_TO_HEAD_RATE_LIMIT_MAX ?? 60),
  timeWindow: Number(process.env.HEAD_TO_HEAD_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

function handleError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    TOURNAMENT_NOT_FOUND: 404,
    PLAYER_NOT_FOUND: 404,
    USER_NOT_FOUND: 404,
    FORBIDDEN: 403,
    ALREADY_PLAYER: 409,
    PLAYER_ALREADY_LINKED: 409,
    PLAYER_ALREADY_REGISTERED: 409,
    INVALID_CLAIM: 422,
    INVALID_LINK: 422,
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

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  // guest_email is not echoed back: every row here matched the caller's own
  // address by definition, so returning it adds nothing and keeps PII out of
  // response logs and client caches.
  fastify.get('/claimable-players', {
    config: { rateLimit: CLAIM_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const user = request.user!;
      try {
        return reply.send(await listClaimablePlayers(user.id));
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  fastify.get('/head-to-head', {
    config: { rateLimit: HEAD_TO_HEAD_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const user = request.user!;
      try {
        return reply.send(await getHeadToHead(user.id));
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  fastify.post<{ Params: { playerId: string }; Body: unknown }>(
    '/claimable-players/:playerId/claim',
    {
      config: { rateLimit: CLAIM_RATE_LIMIT },
      preHandler: [authenticate, fastify.csrfProtection],
      handler: async (request, reply) => {
        const playerId = parseUUID(request.params.playerId);
        if (!playerId) return reply.code(400).send({ error: 'INVALID_ID' });

        const parsed = ClaimPlayerSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        }

        const user = request.user!;
        try {
          const { player, claimed, guest_name } = await claimGuestPlayer(user.id, playerId);

          // Re-claiming a row the caller already owns changes nothing, so it
          // succeeds without an audit entry rather than 404ing a double-submit.
          if (claimed) {
            await safeAudit(request.log, {
              tournamentId: player.tournament_id,
              actorId: user.id,
              action: 'player.claimed',
              entityType: 'tournament_player',
              entityId: player.id,
              detail: { tournament_id: player.tournament_id, guest_name },
            });
          }

          return reply.send(player);
        } catch (err) {
          return handleError(err, reply);
        }
      },
    },
  );
};

export const playerLinkRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { id: string; playerId: string }; Body: unknown }>(
    '/:id/players/:playerId/link',
    {
      config: { rateLimit: CLAIM_RATE_LIMIT },
      preHandler: [authenticate, fastify.csrfProtection],
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const playerId = parseUUID(request.params.playerId);
        if (!id || !playerId) return reply.code(400).send({ error: 'INVALID_ID' });

        const parsed = LinkPlayerSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        }

        const user = request.user!;
        try {
          const { player, guest_name } = await linkPlayerToUser(
            id,
            user.id,
            playerId,
            parsed.data.user_id,
          );

          await safeAudit(request.log, {
            tournamentId: id,
            actorId: user.id,
            action: 'player.linked_by_organizer',
            entityType: 'tournament_player',
            entityId: player.id,
            detail: { user_id: parsed.data.user_id, guest_name },
          });

          return reply.send(player);
        } catch (err) {
          return handleError(err, reply);
        }
      },
    },
  );
};

export default profileRoutes;
