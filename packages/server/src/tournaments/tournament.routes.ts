import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { writeAuditLog } from '../audit/audit.service';
import { AppError } from '../errors/AppError';
import {
  CreateTournamentSchema,
  UpdateTournamentSchema,
  AddPlayerSchema,
  ReorderSeedsSchema,
  UUIDParamSchema,
} from './tournament.schemas';
import {
  createTournament,
  getTournament,
  openRegistration,
  updateTournament,
  listPlayers,
  addUserPlayer,
  addGuestPlayer,
  removePlayer,
  reorderSeeds,
  importPlayersFromCsv,
} from './tournament.service';
import { dropPlayer } from './player.drop.service';

const TOURNAMENT_RATE_LIMIT = {
  max: Number(process.env.TOURNAMENT_RATE_LIMIT_MAX ?? 60),
  timeWindow: Number(process.env.TOURNAMENT_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

const IMPORT_RATE_LIMIT = {
  max: Number(process.env.IMPORT_RATE_LIMIT_MAX ?? 5),
  timeWindow: Number(process.env.IMPORT_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

function parseId(value: string): string | null {
  const result = UUIDParamSchema.safeParse(value);
  return result.success ? result.data : null;
}

// Catch audit log failures separately so they never affect the HTTP response.
// The mutation is already committed; audit failure is a best-effort concern.
async function safeAuditLog(
  log: import('fastify').FastifyBaseLogger,
  params: Parameters<typeof writeAuditLog>[0],
): Promise<void> {
  try {
    await writeAuditLog(params);
  } catch (err) {
    log.error({ err }, 'Failed to write audit log — mutation was committed');
  }
}

function handleServiceError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const statusMap: Record<string, number> = {
    TOURNAMENT_NOT_FOUND: 404,
    PLAYER_NOT_FOUND: 404,
    USER_NOT_FOUND: 404,
    FORBIDDEN: 403,
    TOURNAMENT_NOT_EDITABLE: 409,
    TOURNAMENT_NOT_IN_PROGRESS: 409,
    PLAYER_ALREADY_REGISTERED: 409,
    PLAYER_NOT_ACTIVE: 409,
    DUPLICATE_SEEDS: 422,
    INVALID_SEED_LIST: 422,
    INVALID_CSV: 400,
    CSV_TOO_LARGE: 413,
  };
  return reply.code(statusMap[err.code] ?? 500).send({ error: err.code, message: err.message });
}

const tournamentRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Tournament CRUD ──────────────────────────────────────────────────────

  fastify.post<{ Body: unknown }>('/', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const parsed = CreateTournamentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const user = request.user!;
      const tournament = await createTournament(user.id, parsed.data);

      await safeAuditLog(request.log, {
        tournamentId: tournament.id,
        actorId: user.id,
        action: 'tournament.created',
        entityType: 'tournament',
        entityId: tournament.id,
        detail: { name: tournament.name, format: tournament.format },
      });

      return reply.code(201).send(tournament);
    },
  });

  fastify.get<{ Params: { id: string } }>('/:id', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      try {
        return reply.send(await getTournament(id));
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/:id', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const parsed = UpdateTournamentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const user = request.user!;
      try {
        const { tournament, changed } = await updateTournament(id, user.id, parsed.data);

        if (changed) {
          await safeAuditLog(request.log, {
            tournamentId: id,
            actorId: user.id,
            action: 'tournament.updated',
            entityType: 'tournament',
            entityId: id,
            detail: parsed.data as Record<string, unknown>,
          });
        }

        return reply.send(tournament);
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  fastify.post<{ Params: { id: string } }>('/:id/registration/open', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        const tournament = await openRegistration(id, user.id);

        await safeAuditLog(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'tournament.updated',
          entityType: 'tournament',
          entityId: id,
          detail: { status: tournament.status },
        });

        return reply.send(tournament);
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  // ── Player management ────────────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/:id/players', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      try {
        await getTournament(id); // 404 guard
        return reply.send(await listPlayers(id));
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  fastify.post<{ Params: { id: string }; Body: unknown }>('/:id/players', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const parsed = AddPlayerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const user = request.user!;
      try {
        let player;
        if (parsed.data.type === 'user') {
          player = await addUserPlayer(id, user.id, parsed.data.user_id);
        } else {
          player = await addGuestPlayer(id, user.id, parsed.data.guest_name, parsed.data.guest_email);
        }

        await safeAuditLog(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'player.added',
          entityType: 'tournament_player',
          entityId: player.id,
          detail: { display_name: player.display_name, sort_seed: player.sort_seed },
        });

        return reply.code(201).send(player);
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  fastify.delete<{ Params: { id: string; playerId: string } }>('/:id/players/:playerId', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      const playerId = parseId(request.params.playerId);
      if (!id || !playerId) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        await removePlayer(id, playerId, user.id);

        await safeAuditLog(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'player.removed',
          entityType: 'tournament_player',
          entityId: playerId,
          detail: { player_id: playerId },
        });

        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  // Drop a player mid-tournament (auto-resolves open match as loss for dropped player)
  fastify.patch<{ Params: { id: string; playerId: string } }>('/:id/players/:playerId/drop', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      const playerId = parseId(request.params.playerId);
      if (!id || !playerId) return reply.code(400).send({ error: 'INVALID_ID' });

      const user = request.user!;
      try {
        const result = await dropPlayer(id, playerId, user.id);

        await safeAuditLog(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'player.dropped',
          entityType: 'tournament_player',
          entityId: playerId,
          detail: {
            drop_round: result.drop_round,
            auto_result: result.auto_result,
          },
        });

        return reply.send(result);
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/:id/players/seeds', {
    config: { rateLimit: TOURNAMENT_RATE_LIMIT },
    preHandler: [authenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

      const parsed = ReorderSeedsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const user = request.user!;
      try {
        await reorderSeeds(id, user.id, parsed.data.seeds);

        await safeAuditLog(request.log, {
          tournamentId: id,
          actorId: user.id,
          action: 'player.seeds_reordered',
          entityType: 'tournament',
          entityId: id,
          detail: { count: parsed.data.seeds.length },
        });

        return reply.code(200).send({ ok: true });
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  });

  // CSV import in its own sub-plugin so the text/plain content type parser
  // is scoped only to this endpoint and does not affect other routes.
  await fastify.register(async (importPlugin) => {
    importPlugin.addContentTypeParser(
      'text/plain',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    );

    importPlugin.post<{ Params: { id: string } }>('/:id/players/import', {
      config: { rateLimit: IMPORT_RATE_LIMIT },
      preHandler: [authenticate, fastify.csrfProtection],
      handler: async (request, reply) => {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ error: 'INVALID_ID' });

        const csvText = request.body as string;
        if (typeof csvText !== 'string' || !csvText.trim()) {
          return reply.code(400).send({ error: 'EMPTY_BODY', message: 'CSV body is required' });
        }

        const user = request.user!;
        try {
          const result = await importPlayersFromCsv(id, user.id, csvText);

          await safeAuditLog(request.log, {
            tournamentId: id,
            actorId: user.id,
            action: 'players.imported',
            entityType: 'tournament',
            entityId: id,
            detail: {
              imported: result.imported,
              skipped: result.skipped,
              errors: result.errors.length,
            },
          });

          // 200 for full/partial success with per-row breakdown; 422 if everything failed
          const allFailed = result.imported === 0 && result.errors.length > 0;
          return reply.code(allFailed ? 422 : 200).send(result);
        } catch (err) {
          return handleServiceError(err, reply);
        }
      },
    });
  });
};

export default tournamentRoutes;
