import type { FastifyPluginAsync } from 'fastify';
import { SearchArchiveQuerySchema } from './archive.schemas';
import { searchArchive } from './archive.service';

// A search endpoint doing an ILIKE scan plus a per-row LATERAL join for
// player counts across up to 50 rows/request is meaningfully more expensive
// than the per-ID lookups PUBLIC_RATE_LIMIT (100/60s, public.routes.ts) was
// calibrated for, and this is the first unauthenticated cross-organizer
// listing endpoint in the app — a lower ceiling limits scraping/enumeration
// value.
const ARCHIVE_SEARCH_RATE_LIMIT = {
  max: Number(process.env.ARCHIVE_RATE_LIMIT_MAX ?? 30),
  timeWindow: Number(process.env.ARCHIVE_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

// Same short public cache rationale as public.routes.ts's PUBLIC_CACHE.
const PUBLIC_CACHE = 'public, max-age=15, stale-while-revalidate=30';

const archiveRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/tournaments/archive', {
    config: { rateLimit: ARCHIVE_SEARCH_RATE_LIMIT },
    handler: async (request, reply) => {
      const parsed = SearchArchiveQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }
      const result = await searchArchive(parsed.data);
      return reply.header('Cache-Control', PUBLIC_CACHE).send(result);
    },
  });
};

export default archiveRoutes;
