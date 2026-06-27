import { z } from 'zod';

// Shared payload schemas — used for both signing and runtime validation
// after jwt.verify() to guard against malformed tokens.

export const AccessTokenPayloadSchema = z.object({
  sub: z.string(),
  role: z.enum(['player', 'judge', 'organizer', 'admin']),
  tokenVersion: z.number().int().nonnegative(),
  type: z.literal('access'),
  iss: z.literal('dueltrack'),
  aud: z.literal('dueltrack-api'),
  iat: z.number(),
  exp: z.number(),
});

export const RefreshTokenPayloadSchema = z.object({
  sub: z.string(),
  tokenVersion: z.number().int().nonnegative(),
  type: z.literal('refresh'),
  iss: z.literal('dueltrack'),
  aud: z.literal('dueltrack-api'),
  iat: z.number(),
  exp: z.number(),
});

export type AccessTokenPayload = z.infer<typeof AccessTokenPayloadSchema>;
export type RefreshTokenPayload = z.infer<typeof RefreshTokenPayloadSchema>;

export const JWT_ISSUER = 'dueltrack' as const;
export const JWT_AUDIENCE = 'dueltrack-api' as const;
