'use strict';

/**
 * Adds a composite index on (tournament_id, sort_seed) so the
 * `listPlayers` ORDER BY sort_seed can be satisfied from the index
 * without an in-memory sort pass.
 */
exports.up = (pgm) => {
  pgm.createIndex('tournament_players', ['tournament_id', 'sort_seed'], {
    name: 'idx_tournament_players_tournament_seed',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('tournament_players', ['tournament_id', 'sort_seed'], {
    name: 'idx_tournament_players_tournament_seed',
  });
};
