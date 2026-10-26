'use strict';

/**
 * Guest self-registration retries. A guest has no account to key uniqueness
 * on, so a retry after a lost or timed-out response created a duplicate
 * pending entry. Matching on name/email instead silently merged two real
 * guests who share a name (two walk-in "Sam"s at a kiosk), so the client now
 * sends one random key per form, reused across that form's retries: the
 * same key is the same submission, a different key a different person.
 * NULLs are distinct in a UNIQUE constraint, so keyless submissions (older
 * clients, API callers) are unaffected.
 *
 * Also normalises venue "" to NULL. The API now stores "no venue" as NULL
 * only; older rows with "" would otherwise log a spurious venue change on
 * their next edit.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.sql(`
    ALTER TABLE tournament_registrations
      ADD COLUMN idempotency_key UUID,
      ADD CONSTRAINT uq_registrations_idempotency_key UNIQUE (tournament_id, idempotency_key);

    UPDATE tournaments SET venue = NULL WHERE btrim(venue) = '';
  `);
};

/**
 * The venue normalisation is not reversed — "" and NULL meant the same.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.sql(`
    ALTER TABLE tournament_registrations
      DROP CONSTRAINT IF EXISTS uq_registrations_idempotency_key,
      DROP COLUMN IF EXISTS idempotency_key;
  `);
};
