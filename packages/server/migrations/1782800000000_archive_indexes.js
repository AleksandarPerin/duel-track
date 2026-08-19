'use strict';

/**
 * The public archive search (GET /api/public/tournaments/archive) always
 * filters to status IN ('completed', 'archived') and sorts by
 * COALESCE(scheduled_at, created_at) DESC — unlike Step 19's
 * idx_tournaments_organizer (a plain single-column index, deliberately not
 * partial because excluding just 'draft' left poor selectivity), this index
 * is scoped to exactly the two statuses the archive query ever touches. Most
 * tournaments in typical usage sit in draft/registration/in_progress at any
 * given time, so restricting the index to completed/archived keeps it small
 * and directly serves both the WHERE and ORDER BY of the archive query
 * without a separate sort step. format/name-search filters are not part of
 * this index — see archive.service.ts for why (low cardinality at this
 * project's scale; ILIKE search is deliberately left unindexed).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX idx_tournaments_archive_search
      ON tournaments (status, scheduled_at DESC)
      WHERE status IN ('completed', 'archived');
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX idx_tournaments_archive_search;');
};
