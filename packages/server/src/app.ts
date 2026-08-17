import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import csrfProtection from '@fastify/csrf-protection';
import { pool, setPoolLogger } from './db/pool';
import { redis } from './db/redis';
import authRoutes from './auth/auth.routes';
import tournamentRoutes from './tournaments/tournament.routes';
import pairingRoutes from './pairing/pairing.routes';
import resultRoutes from './results/result.routes';
import standingsRoutes from './standings/standings.routes';
import judgeRoutes from './judges/judge.routes';
import registrationRoutes from './registrations/registration.routes';
import publicRoutes from './public/public.routes';

async function checkWithTimeout(p: Promise<unknown>, ms: number): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  // Second .then() arg suppresses rejections so a DB-down error returns false, not a throw
  return Promise.race([p.then(() => true as const, () => false as const), timeout]);
}

export async function buildApp() {
  if (process.env.NODE_ENV !== 'development' && !process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set in non-development environments');
  }

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET environment variable is required');

  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
    // Trust N upstream proxy hops so request.ip reflects the real client IP for rate limiting.
    // Default 1 for a single LB; set TRUST_PROXY_HOPS=0 to disable in local dev.
    trustProxy: Number(process.env.TRUST_PROXY_HOPS ?? 1),
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

  await app.register(rateLimit, { global: false, redis });

  await app.register(csrfProtection, { sessionPlugin: '@fastify/cookie' });

  // Global error handler: log internals server-side; return a generic 500 to
  // callers for anything unexpected. Trusted Fastify plugin errors (CSRF
  // rejection, rate limiting, body/schema validation) set their own safe 4xx
  // statusCode + message and should pass through as-is rather than being
  // flattened to a 500 — otherwise clients and monitoring can't tell "you
  // were rate limited" or "bad CSRF token" apart from a real server fault.
  // AppError (this app's own error type) never sets statusCode, so it's
  // unaffected here — it's always caught explicitly by each route's handler
  // before reaching this fallback.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Unhandled route error');

    const statusCode = error.statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: error.code ?? 'REQUEST_ERROR', message: error.message });
    }

    reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

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
  await app.register(pairingRoutes, { prefix: '/api/tournaments' });
  await app.register(resultRoutes, { prefix: '/api/tournaments' });
  await app.register(standingsRoutes, { prefix: '/api/tournaments' });
  await app.register(judgeRoutes, { prefix: '/api/tournaments' });
  await app.register(registrationRoutes, { prefix: '/api/tournaments' });
  await app.register(publicRoutes, { prefix: '/api/public' });

  return app;
}
