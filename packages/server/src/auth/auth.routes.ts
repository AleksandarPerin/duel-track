import type { FastifyPluginAsync } from 'fastify';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { RegisterSchema, LoginSchema } from './auth.schemas';
import {
  registerUser,
  verifyCredentials,
  getUserById,
  incrementTokenVersion,
} from './auth.service';
import { verifyGoogleIdToken, findOrCreateOAuthUser } from './oauth.service';
import { AppError } from '../errors/AppError';
import {
  JWT_ISSUER,
  JWT_AUDIENCE,
  RefreshTokenPayloadSchema,
  type RefreshTokenPayload,
} from './auth.types';

// Expiry in seconds (env vars override defaults; numeric to satisfy SignOptions type)
const ACCESS_EXPIRY_S = Number(process.env.JWT_ACCESS_EXPIRY_S ?? 900);      // 15 min
const REFRESH_EXPIRY_S = Number(process.env.JWT_REFRESH_EXPIRY_S ?? 604_800); // 7 days

const JWT_SIGN_OPTIONS = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE } as const;

const AUTH_RATE_LIMIT = {
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
  timeWindow: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} environment variable is required`);
  return v;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Read secrets once at plugin init — a missing secret is a startup failure,
  // not a per-request error.
  const accessSecret = requireEnv('JWT_SECRET');
  const refreshSecret = requireEnv('JWT_REFRESH_SECRET');

  // Cookie security: Secure flag is off only in local dev (not merely non-production,
  // so HTTPS staging environments also get Secure cookies).
  const SECURE_COOKIE = process.env.NODE_ENV !== 'development';

  const BASE_COOKIE = {
    httpOnly: true,
    secure: SECURE_COOKIE,
    sameSite: 'strict',
  } as const;

  function signTokens(userId: string, role: string, tokenVersion: number) {
    const accessToken = jwt.sign(
      { sub: userId, role, tokenVersion, type: 'access' },
      accessSecret,
      { expiresIn: ACCESS_EXPIRY_S, ...JWT_SIGN_OPTIONS },
    );

    const refreshToken = jwt.sign(
      { sub: userId, tokenVersion, type: 'refresh' },
      refreshSecret,
      { expiresIn: REFRESH_EXPIRY_S, ...JWT_SIGN_OPTIONS },
    );

    return { accessToken, refreshToken };
  }

  function verifyRefresh(token: string): RefreshTokenPayload {
    const raw = jwt.verify(token, refreshSecret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const result = RefreshTokenPayloadSchema.safeParse(raw);
    if (!result.success) {
      throw new jwt.JsonWebTokenError('Malformed refresh token payload');
    }
    return result.data;
  }

  // GET /api/auth/csrf — SPA calls this once to prime the double-submit cookie
  // before making any state-mutating request.
  fastify.get('/csrf', async (_req, reply) => {
    const token = await reply.generateCsrf();
    return reply.send({ csrfToken: token });
  });

  fastify.post<{ Body: unknown }>('/register', {
    config: { rateLimit: AUTH_RATE_LIMIT },
    handler: async (request, reply) => {
      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        });
      }

      const { email, display_name, password } = parsed.data;

      try {
        const user = await registerUser(email, display_name, password);
        return reply.code(201).send({
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          role: user.role,
        });
      } catch (err) {
        if (err instanceof AppError && err.code === 'EMAIL_TAKEN') {
          return reply.code(409).send({ error: 'EMAIL_TAKEN' });
        }
        throw err;
      }
    },
  });

  fastify.post<{ Body: unknown }>('/login', {
    config: { rateLimit: AUTH_RATE_LIMIT },
    handler: async (request, reply) => {
      const parsed = LoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        });
      }

      const { email, password } = parsed.data;

      try {
        const user = await verifyCredentials(email, password);
        const { accessToken, refreshToken } = signTokens(
          user.id,
          user.role,
          user.token_version,
        );

        reply
          .setCookie('access_token', accessToken, {
            ...BASE_COOKIE,
            maxAge: ACCESS_EXPIRY_S,
            path: '/',
          })
          .setCookie('refresh_token', refreshToken, {
            ...BASE_COOKIE,
            maxAge: REFRESH_EXPIRY_S,
            // Restrict refresh token to auth endpoints — reduces exposure surface
            path: '/api/auth',
          });

        return reply.code(200).send({
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          role: user.role,
        });
      } catch (err) {
        if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
          return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
        }
        throw err;
      }
    },
  });

  fastify.post('/refresh', {
    config: { rateLimit: AUTH_RATE_LIMIT },
    handler: async (request, reply) => {
      const rawToken = request.cookies?.refresh_token;
      if (!rawToken) {
        return reply.code(401).send({ error: 'NO_REFRESH_TOKEN' });
      }

      let payload: RefreshTokenPayload;
      try {
        payload = verifyRefresh(rawToken);
      } catch {
        return reply.code(401).send({ error: 'INVALID_REFRESH_TOKEN' });
      }

      const user = await getUserById(payload.sub);
      if (!user || user.token_version !== payload.tokenVersion) {
        return reply.code(401).send({ error: 'REFRESH_TOKEN_REVOKED' });
      }

      // Phase 1: no refresh token rotation. A stolen refresh token is valid
      // for its full 7-day window. Phase 2 will add token family tracking
      // and rotation with theft detection (see issue #TODO).
      const { accessToken } = signTokens(user.id, user.role, user.token_version);

      reply.setCookie('access_token', accessToken, {
        ...BASE_COOKIE,
        maxAge: ACCESS_EXPIRY_S,
        path: '/',
      });

      return reply.code(200).send({ ok: true });
    },
  });

  fastify.post('/logout', {
    config: { rateLimit: AUTH_RATE_LIMIT },
    handler: async (request, reply) => {
      const rawToken = request.cookies?.refresh_token;

      if (rawToken) {
        try {
          const payload = verifyRefresh(rawToken);
          // Incrementing token_version invalidates ALL sessions for this user
          // across all devices (Phase 1 simplification — no per-device tokens).
          await incrementTokenVersion(payload.sub);
        } catch {
          // Token invalid or expired — proceed to clear cookies regardless
        }
      }

      reply
        .clearCookie('access_token', { path: '/' })
        .clearCookie('refresh_token', { path: '/api/auth' });

      return reply.code(200).send({ ok: true });
    },
  });

  // ── Google OAuth2 login ──────────────────────────────────────────────────
  // Optional feature: only registered if all three env vars are set, so
  // deployments/tests that don't configure Google OAuth are unaffected.
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (googleClientId && googleClientSecret && googleRedirectUri) {
    const oauthClient = new OAuth2Client(googleClientId, googleClientSecret, googleRedirectUri);
    const OAUTH_CALLBACK_PATH = '/api/auth/oauth/google/callback';
    const OAUTH_STATE_COOKIE = 'oauth_state';
    const OAUTH_STATE_TTL_S = 600; // 10 minutes — enough for a user to complete the Google consent screen
    const FRONTEND_URL = (process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:5173').replace(/\/+$/, '');

    // GET /api/auth/oauth/google — redirect the browser to Google's consent screen
    fastify.get('/oauth/google', {
      config: { rateLimit: AUTH_RATE_LIMIT },
      handler: async (_request, reply) => {
        const state = randomBytes(32).toString('hex');
        const authUrl = oauthClient.generateAuthUrl({
          scope: ['openid', 'email', 'profile'],
          state,
          prompt: 'select_account',
        });

        // SameSite=Lax (not Strict) is required here: the browser returns from
        // accounts.google.com via a top-level cross-site GET navigation, and a
        // Strict cookie would not be sent on that request, breaking the flow.
        reply.setCookie(OAUTH_STATE_COOKIE, state, {
          httpOnly: true,
          secure: SECURE_COOKIE,
          sameSite: 'lax',
          maxAge: OAUTH_STATE_TTL_S,
          path: OAUTH_CALLBACK_PATH,
        });

        return reply.redirect(authUrl);
      },
    });

    // GET /api/auth/oauth/google/callback — exchange the code, verify the ID
    // token, find-or-create the local user, and issue our own session cookies.
    fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/oauth/google/callback',
      {
        config: { rateLimit: AUTH_RATE_LIMIT },
        handler: async (request, reply) => {
          const { code, state, error } = request.query;
          const cookieState = request.cookies?.[OAUTH_STATE_COOKIE];
          reply.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_CALLBACK_PATH });

          if (error || !code || !state || !cookieState || state !== cookieState) {
            return reply.code(401).send({ error: 'OAUTH_STATE_MISMATCH' });
          }

          try {
            const { tokens } = await oauthClient.getToken(code);
            if (!tokens.id_token) {
              return reply.code(401).send({ error: 'OAUTH_NO_ID_TOKEN' });
            }

            const profile = await verifyGoogleIdToken(oauthClient, tokens.id_token, googleClientId);
            const user = await findOrCreateOAuthUser(profile.email, profile.displayName);

            const { accessToken, refreshToken } = signTokens(
              user.id,
              user.role,
              user.token_version,
            );

            reply
              .setCookie('access_token', accessToken, {
                ...BASE_COOKIE,
                maxAge: ACCESS_EXPIRY_S,
                path: '/',
              })
              .setCookie('refresh_token', refreshToken, {
                ...BASE_COOKIE,
                maxAge: REFRESH_EXPIRY_S,
                path: '/api/auth',
              });

            return reply.redirect(`${FRONTEND_URL}/`);
          } catch (err) {
            // Only these two are genuine "the login attempt was rejected" outcomes.
            // Anything else (DB outage, Google API 5xx, an unexpected bug) is an
            // infrastructure failure, not an auth failure — rethrow so the global
            // error handler in app.ts logs it and returns a 500, same as /login.
            if (err instanceof AppError && err.code === 'OAUTH_EMAIL_UNVERIFIED') {
              return reply.code(401).send({ error: 'OAUTH_EMAIL_UNVERIFIED' });
            }
            if (err instanceof AppError && err.code === 'OAUTH_ACCOUNT_EXISTS') {
              return reply.code(409).send({ error: 'OAUTH_ACCOUNT_EXISTS' });
            }
            throw err;
          }
        },
      },
    );
  } else {
    fastify.log.warn(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI not fully set — Google OAuth routes disabled',
    );
  }
};

export default authRoutes;
