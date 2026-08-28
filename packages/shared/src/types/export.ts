// Mirrors the response shape of GET /api/public/tournaments/:id/export/json
// (packages/server/src/public/public.routes.ts's fetchTournamentExport) —
// that function's return type is inferred rather than a named server-side
// interface, so this is a client-facing contract type kept in sync by hand
// rather than a straight re-export.

export interface TournamentExportResult {
  player1_game_wins: number;
  player2_game_wins: number;
  games_drawn: number;
  outcome: string;
  entered_at: string;
}

export interface TournamentExportPairing {
  id: string;
  table_number: number;
  is_bye: boolean;
  player1_id: string;
  player1_name: string;
  player2_id: string | null;
  player2_name: string | null;
  result: TournamentExportResult | null;
}

// omw_percent/gw_percent/ogw_percent are the raw stored fraction (e.g. "0.5500"
// for 55%), serialized as a string by pg's NUMERIC type — multiply by 100 to
// display as a percent.
export interface TournamentExportStanding {
  rank: number;
  player_id: string;
  display_name: string;
  status: string;
  match_points: number;
  match_wins: number;
  match_losses: number;
  match_draws: number;
  game_wins: number;
  game_losses: number;
  omw_percent: string | null;
  gw_percent: string | null;
  ogw_percent: string | null;
}

export interface TournamentExportRound {
  round_number: number;
  phase: string;
  status: string;
  timer_minutes: number;
  started_at: string | null;
  ended_at: string | null;
  pairings: TournamentExportPairing[];
  standings: TournamentExportStanding[];
}

export interface TournamentExport {
  tournament: {
    id: string;
    name: string;
    format: string;
    rel_level: string;
    venue: string | null;
    scheduled_at: string | null;
    status: string;
    total_rounds: number;
    top_cut: number;
  };
  rounds: TournamentExportRound[];
}
