/**
 * Tournament judges — Phase 2 Step 10.
 * A judge is scoped per-tournament (not the global `users.role` column,
 * which stays informational): the organizer assigns any registered user
 * as a judge for their tournament, granting them permission to enter
 * results without the broader organizer permissions (advance rounds,
 * drop players, manage the bracket).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.sql(`
    CREATE TABLE tournament_judges (
      tournament_id UUID NOT NULL REFERENCES tournaments(id),
      user_id       UUID NOT NULL REFERENCES users(id),
      assigned_by   UUID NOT NULL REFERENCES users(id),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tournament_id, user_id)
    );

    CREATE INDEX idx_tournament_judges_user
      ON tournament_judges (user_id);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS tournament_judges;`);
};
