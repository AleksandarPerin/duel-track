export interface PlayerRecord {
  id: string;
  sort_seed: number;
  byes_received: number;
  match_points: number;
  omw_pct: number;
  gw_pct: number;
}

export interface PriorMatch {
  player1_id: string;
  player2_id: string;
}

export interface Match {
  player1_id: string;
  player2_id: string;
}

export interface PairingResult {
  matches: Match[];
  bye_player_id: string | null;
  warning?: string;
}
