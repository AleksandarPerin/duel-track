'use strict';

/**
 * Both analytics queries filter tournaments by organizer_id with no existing
 * index — today that's a full table scan on every dashboard load. Single-
 * column index mirrors the existing idx_tournament_players_tournament /
 * idx_pairings_round style; not partial/composite because the status <>
 * 'draft' filter has poor selectivity (5 of 6 enum values match) so it
 * wouldn't meaningfully shrink the index.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX idx_tournaments_organizer
      ON tournaments (organizer_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX idx_tournaments_organizer;');
};
