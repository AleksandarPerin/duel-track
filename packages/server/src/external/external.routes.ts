import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { authenticateApiToken } from '../middleware/authenticateApiToken';
import { AppError } from '../errors/AppError';
import { getTournament, listOrganizerTournaments } from '../tournaments/tournament.service';
import { getRoundStandings } from '../standings/standings.service';
import { getRoundPairings } from '../pairing/pairing.service';
import { listRoundResults } from '../results/result.service';
import type { Tournament } from '@dueltrack/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUND_RE = /^\d+$/;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}
function parseRoundNumber(v: string): number | null {
  if (!ROUND_RE.test(v)) return null;
  const n = parseInt(v, 10);
  return n >= 1 ? n : null;
}

// More generous than PUBLIC_RATE_LIMIT (100/min, anonymous tier in
// public.routes.ts) since each caller is a known, revocable token — but
// still capped. IP-keyed (the @fastify/rate-limit default): keying by
// apiToken.tokenId is NOT viable here because the rate-limit hook runs at
// onRequest, before the preHandler that decodes the token — apiToken would
// still be undefined when the limiter reads it. Don't attempt a custom
// keyGenerator for this; IP-based is an intentional, sufficient choice.
const EXTERNAL_API_RATE_LIMIT = {
  max: Number(process.env.EXTERNAL_API_RATE_LIMIT_MAX ?? 300),
  timeWindow: Number(process.env.EXTERNAL_API_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

// 404 (not 403) on ownership mismatch — same reasoning as revokeApiToken:
// don't let a caller distinguish "not yours" from "doesn't exist".
async function loadOwnedTournament(id: string, organizerId: string): Promise<Tournament | null> {
  let tournament: Tournament;
  try {
    tournament = await getTournament(id);
  } catch (err) {
    if (err instanceof AppError && err.code === 'TOURNAMENT_NOT_FOUND') return null;
    throw err;
  }
  return tournament.organizer_id === organizerId ? tournament : null;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: 'TOURNAMENT_NOT_FOUND' });
}

type IdParams = { id: string };
type RoundParams = { id: string; roundNumber: string };

const externalRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tournaments — all of the caller's own tournaments, any status.
  fastify.get('/tournaments', {
    config: { rateLimit: EXTERNAL_API_RATE_LIMIT },
    preHandler: [authenticateApiToken],
    handler: async (request, reply) => {
      const tournaments = await listOrganizerTournaments(request.apiToken!.organizerId);
      return reply.send({ tournaments });
    },
  });

  fastify.get<{ Params: IdParams }>('/tournaments/:id', {
    config: { rateLimit: EXTERNAL_API_RATE_LIMIT },
    preHandler: [authenticateApiToken],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      if (!id) return reply.code(400).send({ error: 'INVALID_PARAMS' });
      const tournament = await loadOwnedTournament(id, request.apiToken!.organizerId);
      if (!tournament) return notFound(reply);
      return reply.send(tournament);
    },
  });

  fastify.get<{ Params: RoundParams }>('/tournaments/:id/rounds/:roundNumber/standings', {
    config: { rateLimit: EXTERNAL_API_RATE_LIMIT },
    preHandler: [authenticateApiToken],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      const rn = parseRoundNumber(request.params.roundNumber);
      if (!id || rn === null) return reply.code(400).send({ error: 'INVALID_PARAMS' });
      const tournament = await loadOwnedTournament(id, request.apiToken!.organizerId);
      if (!tournament) return notFound(reply);
      const standings = await getRoundStandings(id, rn);
      return reply.send({ standings });
    },
  });

  fastify.get<{ Params: RoundParams }>('/tournaments/:id/rounds/:roundNumber/pairings', {
    config: { rateLimit: EXTERNAL_API_RATE_LIMIT },
    preHandler: [authenticateApiToken],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      const rn = parseRoundNumber(request.params.roundNumber);
      if (!id || rn === null) return reply.code(400).send({ error: 'INVALID_PARAMS' });
      const tournament = await loadOwnedTournament(id, request.apiToken!.organizerId);
      if (!tournament) return notFound(reply);
      const result = await getRoundPairings(id, rn);
      if (!result) return reply.code(404).send({ error: 'ROUND_NOT_FOUND' });
      return reply.send(result);
    },
  });

  fastify.get<{ Params: RoundParams }>('/tournaments/:id/rounds/:roundNumber/results', {
    config: { rateLimit: EXTERNAL_API_RATE_LIMIT },
    preHandler: [authenticateApiToken],
    handler: async (request, reply) => {
      const id = parseUUID(request.params.id);
      const rn = parseRoundNumber(request.params.roundNumber);
      if (!id || rn === null) return reply.code(400).send({ error: 'INVALID_PARAMS' });
      const tournament = await loadOwnedTournament(id, request.apiToken!.organizerId);
      if (!tournament) return notFound(reply);
      const results = await listRoundResults(id, rn);
      return reply.send({ results });
    },
  });
};

export default externalRoutes;
