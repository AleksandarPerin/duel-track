'use strict';

/**
 * Supports the cross-tournament claimable-guest lookup, which filters on
 * lower(guest_email) across all tournaments. Partial + expression index so it
 * matches the query predicate exactly and stays small — claimable rows are a
 * minority of the table and shrink as rows get claimed.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX idx_tournament_players_claimable
      ON tournament_players (lower(guest_email))
      WHERE user_id IS NULL AND guest_email IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX idx_tournament_players_claimable;');
};
