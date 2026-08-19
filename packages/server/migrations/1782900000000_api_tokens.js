'use strict';

/**
 * API tokens for third-party read-only integrations (Phase 3, PRD line 783).
 * Each row is metadata only — the signed JWT itself is never stored, only
 * this row's id (embedded in the JWT as `jti`) plus label/timestamps needed
 * for an organizer to list and revoke their own tokens. Revocation is
 * modeled as revoked_at IS NOT NULL rather than a DELETE so last_used_at
 * history isn't lost and a revoked token's id can never be reissued.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.sql(`
    CREATE TABLE api_tokens (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organizer_id  UUID NOT NULL REFERENCES users(id),
      label         TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at    TIMESTAMPTZ,
      last_used_at  TIMESTAMPTZ
    );

    CREATE INDEX idx_api_tokens_organizer ON api_tokens (organizer_id);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS api_tokens;`);
};
