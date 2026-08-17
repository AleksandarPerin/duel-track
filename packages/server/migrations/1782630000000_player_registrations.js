/**
 * Player self-registration + TO approval queue — Phase 2 Step 12.
 *
 * `tournaments.registration_token` is the unguessable value embedded in the
 * shareable link (`/register/:token`). It is DB-generated (volatile default,
 * evaluated per-row) so every tournament — including ones from before this
 * migration — gets a distinct token without any application-side backfill.
 * Built from two concatenated gen_random_uuid() calls (same primitive
 * already used for every id column — no pgcrypto extension required) for
 * ~244 bits of entropy, comfortably more than an unguessable link needs.
 *
 * A submission first lands in `tournament_registrations` as 'pending' and
 * only becomes a real `tournament_players` row once the organizer approves
 * it (see registration.service.ts). The partial unique index blocks a given
 * user from having more than one live (pending or approved) submission for
 * the same tournament; guest submissions have no such identity to key off,
 * so duplicates there are left for the organizer to reject manually.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.sql(`
    ALTER TABLE tournaments
      ADD COLUMN registration_token TEXT UNIQUE NOT NULL
        DEFAULT (
          replace(gen_random_uuid()::text, '-', '') ||
          replace(gen_random_uuid()::text, '-', '')
        );
  `);

  pgm.sql(`
    CREATE TABLE tournament_registrations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tournament_id UUID NOT NULL REFERENCES tournaments(id),
      user_id       UUID REFERENCES users(id),
      guest_name    TEXT,
      guest_email   TEXT,
      status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
      decided_by    UUID REFERENCES users(id),
      decided_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
    );

    CREATE UNIQUE INDEX idx_registrations_user_live
      ON tournament_registrations (tournament_id, user_id)
      WHERE user_id IS NOT NULL AND status IN ('pending', 'approved');

    CREATE INDEX idx_registrations_tournament
      ON tournament_registrations (tournament_id, status);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS tournament_registrations;`);
  pgm.sql(`ALTER TABLE tournaments DROP COLUMN IF EXISTS registration_token;`);
};
