import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from '../audit/audit.service';
import { DecideRegistrationSchema } from './registration.schemas';
import { listRegistrations, getRegistrationLink, decideRegistration } from './registration.service';
import type { RegistrationStatus } from '@dueltrack/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALUES = new Set(['pending', 'approved', 'rejected']);

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

const REGISTRATION_RATE_LIMIT = {
  max: Number(process.env.TOURNAMENT_RATE_LIMIT_MAX ?? 60),
  timeWindow: Number(process.env.TOURNAMENT_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

function handleError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    TOURNAMENT_NOT_FOUND: 404,
    REGISTRATION_NOT_FOUND: 404,
    FORBIDDEN: 403,
    REGISTRATION_ALREADY_DECIDED: 409,
    TOURNAMENT_NOT_EDITABLE: 409,
    PLAYER_ALREADY_REGISTERED: 409,
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

const registrationRoutes: FastifyPluginAsync = async (fastify) => {
  // Organizer's shareable link — deliberately not embedded in the general
  // GET /:id tournament response so the token isn't broadcast to anyone who
  // can view the tournament, only to the organizer who shares it themselves.
  fastify.get<{ Params: { id: string } }>('/:id/registration-link', {
    config: { rateLimit: REGISTRATION_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        const { token } = await getRegistrationLink(id, user.id);
        return reply.send({ token, path: `/register/${token}` });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  fastify.get<{ Params: { id: string }; Querystring: { status?: string } }>('/:id/registrations', {
    config: { rateLimit: REGISTRATION_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const { status } = request.query;
      if (status !== undefined && !STATUS_VALUES.has(status)) {
        return reply.code(400).send({ error: 'INVALID_STATUS' });
      }

      const user = request.user!;
      try {
        const registrations = await listRegistrations(id, user.id, status as RegistrationStatus | undefined);
        return reply.send(registrations);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  });

  fastify.post<{ Params: { id: string; registrationId: string }; Body: unknown }>(
    '/:id/registrations/:registrationId/decision',
    {
      config: { rateLimit: REGISTRATION_RATE_LIMIT },
      preHandler: [authenticate, fastify.csrfProtection],
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const registrationId = parseUUID(request.params.registrationId);
        if (!id || !registrationId) return reply.code(400).send({ error: 'INVALID_ID' });

        const parsed = DecideRegistrationSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        }

        const user = request.user!;
        try {
          const registration = await decideRegistration(id, user.id, registrationId, parsed.data.decision);

          await safeAudit(request.log, {
            tournamentId: id,
            actorId: user.id,
            action: parsed.data.decision === 'approved' ? 'registration.approved' : 'registration.rejected',
            entityType: 'tournament_registration',
            entityId: registration.id,
            detail: { user_id: registration.user_id, guest_name: registration.guest_name },
          });

          return reply.send(registration);
        } catch (err) {
          // decideRegistration auto-rejects a stale registration (see the
          // savepoint recovery path) when the target user already has a
          // tournament_players row by the time approval runs — that's a real
          // state change, so it gets an audit entry same as any other
          // decision, even though the request itself ends in an error.
          if (err instanceof AppError && err.code === 'PLAYER_ALREADY_REGISTERED') {
            await safeAudit(request.log, {
              tournamentId: id,
              actorId: user.id,
              action: 'registration.rejected',
              entityType: 'tournament_registration',
              entityId: registrationId,
              detail: { auto_rejected: true, reason: 'PLAYER_ALREADY_REGISTERED' },
            });
          }
          return handleError(err, reply);
        }
      },
    },
  );
};

export default registrationRoutes;
