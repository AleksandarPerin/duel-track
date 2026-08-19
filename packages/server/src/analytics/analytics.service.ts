import { pool } from '../db/pool';
import type { AttendanceTrendEntry, FormatPopularityEntry } from '@dueltrack/shared';

interface AttendanceTrendRow {
  tournament_id: string;
  name: string;
  format: AttendanceTrendEntry['format'];
  scheduled_at: string | null;
  status: AttendanceTrendEntry['status'];
  player_count: string;
}

// Chronological ascending so a trend line reads left-to-right through time.
// scheduled_at is nullable, so COALESCE to created_at keeps ordering total;
// tournament id is the final tie-break for rows sharing an exact timestamp.
export async function getAttendanceTrend(organizerId: string): Promise<AttendanceTrendEntry[]> {
  const { rows } = await pool.query<AttendanceTrendRow>(
    `SELECT
       t.id AS tournament_id,
       t.name,
       t.format,
       t.scheduled_at,
       t.status,
       COUNT(tp.id) AS player_count
     FROM tournaments t
     LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
     WHERE t.organizer_id = $1
       AND t.status <> 'draft'
     GROUP BY t.id
     ORDER BY COALESCE(t.scheduled_at, t.created_at) ASC, t.id ASC`,
    [organizerId],
  );
  return rows.map((row) => ({
    tournament_id: row.tournament_id,
    name: row.name,
    format: row.format,
    scheduled_at: row.scheduled_at ?? undefined,
    status: row.status,
    player_count: Number(row.player_count),
  }));
}

interface FormatPopularityRow {
  format: FormatPopularityEntry['format'];
  tournament_count: string;
  total_player_count: string;
}

// COUNT(DISTINCT t.id) is required (not plain COUNT) because the join
// multiplies tournament rows by player count.
export async function getFormatPopularity(organizerId: string): Promise<FormatPopularityEntry[]> {
  const { rows } = await pool.query<FormatPopularityRow>(
    `SELECT
       t.format,
       COUNT(DISTINCT t.id) AS tournament_count,
       COUNT(tp.id) AS total_player_count
     FROM tournaments t
     LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
     WHERE t.organizer_id = $1
       AND t.status <> 'draft'
     GROUP BY t.format
     ORDER BY tournament_count DESC, total_player_count DESC, t.format ASC`,
    [organizerId],
  );
  return rows.map((row) => ({
    format: row.format,
    tournament_count: Number(row.tournament_count),
    total_player_count: Number(row.total_player_count),
  }));
}
