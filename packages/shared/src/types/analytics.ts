import type { TournamentFormat, TournamentStatus } from './tournament';

export interface AttendanceTrendEntry {
  tournament_id: string;
  name: string;
  format: TournamentFormat;
  scheduled_at?: string;
  status: TournamentStatus;
  player_count: number;
}

export interface FormatPopularityEntry {
  format: TournamentFormat;
  tournament_count: number;
  total_player_count: number;
}
