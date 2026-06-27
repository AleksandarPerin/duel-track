export type TournamentStatus =
  | 'draft'
  | 'registration'
  | 'in_progress'
  | 'top_cut'
  | 'completed'
  | 'archived';

export type TournamentFormat =
  | 'standard'
  | 'pioneer'
  | 'modern'
  | 'legacy'
  | 'vintage'
  | 'draft'
  | 'sealed';

export type RELLevel = 'regular' | 'competitive' | 'professional';

export interface Tournament {
  id: string;
  organizer_id: string;
  name: string;
  format: TournamentFormat;
  rel_level: RELLevel;
  venue?: string;
  scheduled_at?: string;
  status: TournamentStatus;
  total_rounds: number;
  current_round: number;
  top_cut: 0 | 2 | 4 | 8;
  created_at: string;
}
