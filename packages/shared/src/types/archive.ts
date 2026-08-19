import type { TournamentFormat, RELLevel, TournamentStatus } from './tournament';

export interface ArchiveTournamentSummary {
  id: string;
  name: string;
  format: TournamentFormat;
  rel_level: RELLevel;
  venue: string | null;
  scheduled_at: string | null;
  status: Extract<TournamentStatus, 'completed' | 'archived'>;
  total_rounds: number;
  player_count: number;
}

export interface ArchiveSearchPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ArchiveSearchResult {
  tournaments: ArchiveTournamentSummary[];
  pagination: ArchiveSearchPagination;
}
