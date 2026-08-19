import { describe, it, expect } from 'vitest';
import {
  AccessTokenPayloadSchema,
  RefreshTokenPayloadSchema,
  ApiTokenPayloadSchema,
} from './auth.types';

const iat = 1_700_000_000;
const exp = iat + 3600;

function accessPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    role: 'organizer',
    tokenVersion: 0,
    type: 'access',
    iss: 'dueltrack',
    aud: 'dueltrack-api',
    iat,
    exp,
    ...overrides,
  };
}

function refreshPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    tokenVersion: 0,
    type: 'refresh',
    iss: 'dueltrack',
    aud: 'dueltrack-api',
    iat,
    exp,
    ...overrides,
  };
}

function apiPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    jti: 'token-1',
    type: 'api',
    iss: 'dueltrack',
    aud: 'dueltrack-api',
    iat,
    exp,
    ...overrides,
  };
}

describe('token payload schemas each accept only their own shape', () => {
  it('AccessTokenPayloadSchema accepts a well-formed access payload', () => {
    expect(AccessTokenPayloadSchema.safeParse(accessPayload()).success).toBe(true);
  });

  it('RefreshTokenPayloadSchema accepts a well-formed refresh payload', () => {
    expect(RefreshTokenPayloadSchema.safeParse(refreshPayload()).success).toBe(true);
  });

  it('ApiTokenPayloadSchema accepts a well-formed api payload', () => {
    expect(ApiTokenPayloadSchema.safeParse(apiPayload()).success).toBe(true);
  });
});

describe('token type confusion is genuinely rejected, not just intended', () => {
  it('ApiTokenPayloadSchema rejects a session access token payload', () => {
    const result = ApiTokenPayloadSchema.safeParse(accessPayload());
    expect(result.success).toBe(false);
  });

  it('ApiTokenPayloadSchema rejects a refresh token payload', () => {
    const result = ApiTokenPayloadSchema.safeParse(refreshPayload());
    expect(result.success).toBe(false);
  });

  it('AccessTokenPayloadSchema rejects an api token payload', () => {
    const result = AccessTokenPayloadSchema.safeParse(apiPayload());
    expect(result.success).toBe(false);
  });

  it('RefreshTokenPayloadSchema rejects an api token payload', () => {
    const result = RefreshTokenPayloadSchema.safeParse(apiPayload());
    expect(result.success).toBe(false);
  });

  it('AccessTokenPayloadSchema rejects a refresh token payload', () => {
    expect(AccessTokenPayloadSchema.safeParse(refreshPayload()).success).toBe(false);
  });

  it('RefreshTokenPayloadSchema rejects an access token payload', () => {
    expect(RefreshTokenPayloadSchema.safeParse(accessPayload()).success).toBe(false);
  });

  it('ApiTokenPayloadSchema rejects an access-shaped payload even if `type` alone is overwritten to "api"', () => {
    // Guards against relying solely on the `type` literal: an access payload
    // relabelled `type: 'api'` is still missing `jti` and carries the wrong
    // extra fields, so the required-field shape must also fail it.
    const forged = accessPayload({ type: 'api' });
    expect(ApiTokenPayloadSchema.safeParse(forged).success).toBe(false);
  });

  it('AccessTokenPayloadSchema rejects an api-shaped payload even if `type` alone is overwritten to "access"', () => {
    const forged = apiPayload({ type: 'access' });
    expect(AccessTokenPayloadSchema.safeParse(forged).success).toBe(false);
  });
});
