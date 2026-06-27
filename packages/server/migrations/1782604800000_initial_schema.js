/**
 * Initial schema — DuelTrack Phase 1
 * All 7 tables from PRD Section 6.3 plus indexes.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  // ── users ──────────────────────────────────────────────────────────────────
  // password_hash is nullable to support future OAuth2 users (PRD §6.1).
  // token_version is incremented on password change / logout to invalidate
  // outstanding refresh tokens without a separate denylist table.
  pgm.sql(`
    CREATE TABLE users (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email          TEXT UNIQUE NOT NULL,
      display_name   TEXT NOT NULL,
      password_hash  TEXT,
      wpn_number     TEXT,
      role           TEXT NOT NULL DEFAULT 'player'
                       CHECK (role IN ('player', 'judge', 'organizer', 'admin')),
      token_version  INT NOT NULL DEFAULT 0,
      profile_public BOOLEAN NOT NULL DEFAULT TRUE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── tournaments ────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE tournaments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organizer_id  UUID NOT NULL REFERENCES users(id),
      name          TEXT NOT NULL,
      format        TEXT NOT NULL
                      CHECK (format IN (
                        'standard', 'pioneer', 'modern', 'legacy',
                        'vintage', 'draft', 'sealed'
                      )),
      rel_level     TEXT NOT NULL
                      CHECK (rel_level IN ('regular', 'competitive', 'professional')),
      venue         TEXT,
      scheduled_at  TIMESTAMPTZ,
      status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN (
                        'draft', 'registration', 'in_progress',
                        'top_cut', 'completed', 'archived'
                      )),
      total_rounds  INT NOT NULL CHECK (total_rounds BETWEEN 3 AND 10),
      current_round INT NOT NULL DEFAULT 0,
      top_cut       INT NOT NULL DEFAULT 8
                      CHECK (top_cut IN (0, 2, 4, 8)),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── tournament_players ─────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE tournament_players (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tournament_id   UUID NOT NULL REFERENCES tournaments(id),
      user_id         UUID REFERENCES users(id),
      guest_name      TEXT,
      guest_email     TEXT,
      sort_seed       INT NOT NULL,
      byes_received   INT NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'dropped', 'disqualified')),
      drop_round      INT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tournament_id, user_id),
      CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
    );
  `);

  // ── rounds ─────────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE rounds (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tournament_id UUID NOT NULL REFERENCES tournaments(id),
      round_number  INT NOT NULL CHECK (round_number >= 1),
      phase         TEXT NOT NULL DEFAULT 'swiss'
                      CHECK (phase IN ('swiss', 'elimination')),
      status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'completed')),
      timer_minutes INT NOT NULL DEFAULT 50 CHECK (timer_minutes > 0),
      started_at    TIMESTAMPTZ,
      ended_at      TIMESTAMPTZ,
      UNIQUE (tournament_id, round_number)
    );
  `);

  // ── pairings ───────────────────────────────────────────────────────────────
  // is_bye: generated column (player2_id IS NULL means bye).
  // Self-pairing guard: a player cannot be paired against themselves.
  pgm.sql(`
    CREATE TABLE pairings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      round_id        UUID NOT NULL REFERENCES rounds(id),
      table_number    INT NOT NULL CHECK (table_number >= 1),
      player1_id      UUID NOT NULL REFERENCES tournament_players(id),
      player2_id      UUID REFERENCES tournament_players(id),
      is_bye          BOOLEAN NOT NULL GENERATED ALWAYS AS (player2_id IS NULL) STORED,
      override_note   TEXT,
      UNIQUE (round_id, table_number),
      CHECK (player2_id IS NULL OR player1_id != player2_id)
    );
  `);

  // ── results ────────────────────────────────────────────────────────────────
  // Stored separately from pairings for a clean audit trail (PRD §6.4).
  //
  // valid_game_total enforces per-outcome consistency:
  //   intentional_draw / double_loss  → 0 wins/draws recorded
  //                                     (app adds 2 games_played for DML in standings)
  //   player1_win (2-0 or 2-1)        → p1 has exactly 2 wins
  //   player2_win (0-2 or 1-2)        → p2 has exactly 2 wins
  //   draw (1-1-1)                    → 1-1 with 1 drawn game
  pgm.sql(`
    CREATE TABLE results (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pairing_id         UUID NOT NULL UNIQUE REFERENCES pairings(id),
      player1_game_wins  INT NOT NULL CHECK (player1_game_wins BETWEEN 0 AND 2),
      player2_game_wins  INT NOT NULL CHECK (player2_game_wins BETWEEN 0 AND 2),
      games_drawn        INT NOT NULL DEFAULT 0 CHECK (games_drawn BETWEEN 0 AND 1),
      outcome            TEXT NOT NULL
                           CHECK (outcome IN (
                             'player1_win', 'player2_win', 'draw',
                             'intentional_draw', 'double_loss'
                           )),
      entered_by         UUID NOT NULL REFERENCES users(id),
      entered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT valid_game_total CHECK (
        (outcome IN ('intentional_draw', 'double_loss')
           AND player1_game_wins = 0
           AND player2_game_wins = 0
           AND games_drawn = 0)
        OR (outcome = 'player1_win'
           AND player1_game_wins = 2
           AND player2_game_wins IN (0, 1)
           AND games_drawn = 0)
        OR (outcome = 'player2_win'
           AND player2_game_wins = 2
           AND player1_game_wins IN (0, 1)
           AND games_drawn = 0)
        OR (outcome = 'draw'
           AND player1_game_wins = 1
           AND player2_game_wins = 1
           AND games_drawn = 1)
      )
    );
  `);

  // ── standings ──────────────────────────────────────────────────────────────
  // Materialised per round when TO advances. Never recalculated on read
  // (PRD §6.4 scalability strategy).
  pgm.sql(`
    CREATE TABLE standings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tournament_id   UUID NOT NULL REFERENCES tournaments(id),
      round_number    INT NOT NULL CHECK (round_number >= 1),
      player_id       UUID NOT NULL REFERENCES tournament_players(id),
      match_points    INT NOT NULL CHECK (match_points >= 0),
      match_wins      INT NOT NULL CHECK (match_wins >= 0),
      match_losses    INT NOT NULL CHECK (match_losses >= 0),
      match_draws     INT NOT NULL CHECK (match_draws >= 0),
      game_wins       INT NOT NULL CHECK (game_wins >= 0),
      game_losses     INT NOT NULL CHECK (game_losses >= 0),
      omw_percent     NUMERIC(6, 4),
      gw_percent      NUMERIC(6, 4),
      ogw_percent     NUMERIC(6, 4),
      rank            INT CHECK (rank >= 1),
      is_published    BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE (tournament_id, round_number, player_id)
    );
  `);

  // ── audit_log ──────────────────────────────────────────────────────────────
  // Append-only — rows are NEVER updated or deleted.
  // action values are validated at the application layer (Zod) rather than
  // via a DB CHECK so new event types can be added without an ALTER TABLE.
  pgm.sql(`
    CREATE TABLE audit_log (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tournament_id UUID NOT NULL REFERENCES tournaments(id),
      actor_id      UUID NOT NULL REFERENCES users(id),
      action        TEXT NOT NULL,
      entity_type   TEXT,
      entity_id     UUID,
      detail        JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── indexes ────────────────────────────────────────────────────────────────
  // idx_results_pairing is intentionally omitted — the UNIQUE constraint on
  // results.pairing_id already creates an equivalent btree index.
  pgm.sql(`
    CREATE INDEX idx_tournament_players_tournament
      ON tournament_players (tournament_id);

    CREATE INDEX idx_pairings_round
      ON pairings (round_id);

    CREATE INDEX idx_standings_tournament_round
      ON standings (tournament_id, round_number);

    CREATE INDEX idx_standings_published
      ON standings (tournament_id, round_number)
      WHERE is_published = TRUE;

    CREATE INDEX idx_audit_tournament
      ON audit_log (tournament_id, created_at DESC);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS standings;
    DROP TABLE IF EXISTS results;
    DROP TABLE IF EXISTS pairings;
    DROP TABLE IF EXISTS rounds;
    DROP TABLE IF EXISTS tournament_players;
    DROP TABLE IF EXISTS tournaments;
    DROP TABLE IF EXISTS users;
  `);
};
