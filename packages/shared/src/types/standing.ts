// Raw DB row — tiebreakers nullable before first round completes
export interface Standing {
  id: string;
  tournament_id: string;
  round_number: number;
  player_id: string;
  match_points: number;
  match_wins: number;
  match_losses: number;
  match_draws: number;
  game_wins: number;
  game_losses: number;
  omw_percent?: number;
  gw_percent?: number;
  ogw_percent?: number;
  rank?: number;
  is_published: boolean;
}

// API response type — tiebreakers required; this is what the standings service emits
export interface ComputedStanding extends Standing {
  omw_percent: number;
  gw_percent: number;
  ogw_percent: number;
  rank: number;
}

export interface StandingView extends ComputedStanding {
  display_name: string;
}
