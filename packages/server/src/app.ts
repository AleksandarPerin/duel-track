import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import csrfProtection from '@fastify/csrf-protection';
import { pool, setPoolLogger } from './db/pool';
import { redis } from './db/redis';
import authRoutes from './auth/auth.routes';
import tournamentRoutes from './tournaments/tournament.routes';

async function checkWithTimeout(p: Promise<unknown>, ms: number): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([p.then(() => true as const), timeout]);
}

export async function buildApp() {
  if (process.env.NODE_ENV !== 'development' && !process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set in non-development environments');
  }

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET environment variable is required');

  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
  });

  // Wire pool errors through the structured Fastify logger
  setPoolLogger((msg, err) => app.log.error({ err }, msg));

  // Plugin registration order: cookie → cors → rate-limit → csrf
  await app.register(cookie);

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, { global: false });

  await app.register(csrfProtection, { sessionPlugin: '@fastify/cookie' });

  // ── routes ──────────────────────────────────────────────────────────────
  // Health check returns only status; internal breakdown is server-side logged only.
  app.get('/health', async (request, reply) => {
    const TIMEOUT_MS = 3_000;
    const [dbOk, redisOk] = await Promise.all([
      checkWithTimeout(pool.query('SELECT 1'), TIMEOUT_MS),
      checkWithTimeout(redis.ping(), TIMEOUT_MS),
    ]);
    const healthy = dbOk && redisOk;
    if (!healthy) {
      request.log.warn({ dbOk, redisOk }, 'Health check degraded');
    }
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
    });
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(tournamentRoutes, { prefix: '/api/tournaments' });

  return app;
}
