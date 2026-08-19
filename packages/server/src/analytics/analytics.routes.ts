import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { getAttendanceTrend, getFormatPopularity } from './analytics.service';

const ANALYTICS_RATE_LIMIT = {
  max: Number(process.env.ANALYTICS_RATE_LIMIT_MAX ?? 30),
  timeWindow: Number(process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

// organizer_id is scoped directly in the aggregate SQL (see analytics.service.ts) —
// there's nothing to 403 on here, so no AppError/handleError machinery. Anything
// unexpected falls through to app.ts's global error handler.
const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/analytics/attendance', {
    config: { rateLimit: ANALYTICS_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      return reply.send(await getAttendanceTrend(request.user!.id));
    },
  });

  fastify.get('/analytics/format-popularity', {
    config: { rateLimit: ANALYTICS_RATE_LIMIT },
    preHandler: authenticate,
    handler: async (request, reply) => {
      return reply.send(await getFormatPopularity(request.user!.id));
    },
  });
};

export default analyticsRoutes;
