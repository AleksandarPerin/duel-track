import { pool } from '../db/pool';
import type { SearchArchiveQuery } from './archive.schemas';
import type { ArchiveSearchResult, ArchiveTournamentSummary } from '@dueltrack/shared';

const ARCHIVE_STATUSES = ['completed', 'archived'];

export async function searchArchive(query: SearchArchiveQuery): Promise<ArchiveSearchResult> {
  const conditions = ['t.status = ANY($1)'];
  const params: unknown[] = [ARCHIVE_STATUSES];

  if (query.format) {
    params.push(query.format);
    conditions.push(`t.format = $${params.length}`);
  }
  if (query.q) {
    // Deliberately unindexed ILIKE — see migration 1782800000000 comment;
    // table cardinality at this project's scale doesn't justify a
    // trigram/GIN index yet.
    params.push(`%${query.q}%`);
    conditions.push(`t.name ILIKE $${params.length}`);
  }
  if (query.date_from) {
    params.push(query.date_from);
    conditions.push(`t.scheduled_at >= $${params.length}`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    conditions.push(`t.scheduled_at <= $${params.length}`);
  }

  const where = conditions.join(' AND ');
  const offset = (query.page - 1) * query.limit;
  const pageParams = [...params, query.limit, offset];

  // total must come from a COUNT(*) over the full WHERE match, not from
  // COUNT(*) OVER() on the page query — that window function only reflects
  // rows actually returned, so it silently reports 0 whenever `page` is past
  // the last page even though matches exist.
  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<ArchiveTournamentSummary>(
      `SELECT t.id, t.name, t.format, t.rel_level, t.venue, t.scheduled_at, t.status, t.total_rounds,
              COALESCE(pc.player_count, 0) AS player_count
       FROM tournaments t
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS player_count
         FROM tournament_players tp
         WHERE tp.tournament_id = t.id AND tp.status != 'disqualified'
       ) pc ON TRUE
       WHERE ${where}
       ORDER BY COALESCE(t.scheduled_at, t.created_at) DESC, t.id DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM tournaments t WHERE ${where}`,
      params,
    ),
  ]);

  const total = Number(countRows[0]!.total);

  return {
    tournaments: rows,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}
