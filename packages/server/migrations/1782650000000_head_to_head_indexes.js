'use strict';

/**
 * Supports the head-to-head endpoint's two-sided lookup (every pairing the
 * caller played in, as either player1 or player2) and the caller's-own-rows
 * lookup that seeds it. Partial index on user_id mirrors
 * idx_tournament_players_claimable — most tournament_players rows are
 * guests, so a partial index keeps it small.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX idx_tournament_players_user
      ON tournament_players (user_id)
      WHERE user_id IS NOT NULL;
  `);
  pgm.sql(`
    CREATE INDEX idx_pairings_player1
      ON pairings (player1_id);
  `);
  pgm.sql(`
    CREATE INDEX idx_pairings_player2
      ON pairings (player2_id)
      WHERE player2_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX idx_pairings_player2;');
  pgm.sql('DROP INDEX idx_pairings_player1;');
  pgm.sql('DROP INDEX idx_tournament_players_user;');
};
