import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from '../audit/audit.service';
import { pool } from '../db/pool';
import { getRoundStandings, publishRoundStandings } from './standings.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

function handleError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    STANDINGS_NOT_FOUND: 404,
    FORBIDDEN: 403,
    TOURNAMENT_NOT_FOUND: 404,
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

const STANDINGS_RATE_LIMIT = {
  max: Number(process.env.STANDINGS_RATE_LIMIT_MAX ?? 60),
  timeWindow: Number(process.env.STANDINGS_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

const standingsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get standings for a specific round (organizer sees all; others only see published)
  fastify.get<{ Params: { id: string; roundNumber: string } }>(
    '/:id/rounds/:roundNumber/standings',
    {
      config: { rateLimit: STANDINGS_RATE_LIMIT },
      preHandler: authenticate,
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const rn = parseInt(request.params.roundNumber, 10);
        if (!id || isNaN(rn) || rn < 1) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }
        try {
          const { rows: tRows } = await pool.query<{ organizer_id: string }>(
            'SELECT organizer_id FROM tournaments WHERE id = $1', [id],
          );
          if (!tRows[0]) return reply.code(404).send({ error: 'TOURNAMENT_NOT_FOUND' });
          const isOrganizer = tRows[0].organizer_id === request.user!.id;

          const standings = await getRoundStandings(id, rn);
          if (standings.length === 0) {
            return reply.code(404).send({ error: 'STANDINGS_NOT_FOUND' });
          }
          // Non-organizers can only see published standings (RES-05)
          if (!isOrganizer && !standings[0]!.is_published) {
            return reply.code(404).send({ error: 'STANDINGS_NOT_FOUND' });
          }
          return reply.send(standings);
        } catch (err) {
          return handleError(err, reply);
        }
      },
    },
  );

  // Publish standings for a specific round (TO only)
  fastify.post<{ Params: { id: string; roundNumber: string } }>(
    '/:id/rounds/:roundNumber/publish',
    {
      config: { rateLimit: STANDINGS_RATE_LIMIT },
      preHandler: [authenticate, fastify.csrfProtection],
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const rn = parseInt(request.params.roundNumber, 10);
        if (!id || isNaN(rn) || rn < 1) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }
        const user = request.user!;
        try {
          // Verify caller is the tournament organizer
          const { rows: tRows } = await pool.query<{ organizer_id: string }>(
            'SELECT organizer_id FROM tournaments WHERE id = $1',
            [id],
          );
          if (!tRows[0]) {
            throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
          }
          if (tRows[0].organizer_id !== user.id) {
            throw new AppError('FORBIDDEN', 'Only the organizer can publish standings');
          }

          // publishRoundStandings throws STANDINGS_NOT_FOUND if no rows exist
          await publishRoundStandings(id, rn);

          await safeAudit(request.log, {
            tournamentId: id,
            actorId: user.id,
            action: 'standings.published',
            entityType: 'standings',
            entityId: id,
            detail: { round_number: rn },
          });

          return reply.code(200).send({ published: true });
        } catch (err) {
          return handleError(err, reply);
        }
      },
    },
  );
};

export default standingsRoutes;
