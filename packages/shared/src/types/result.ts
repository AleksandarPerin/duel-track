export type ResultOutcome =
  | 'player1_win'
  | 'player2_win'
  | 'draw'
  | 'intentional_draw'
  | 'double_loss';

export interface Result {
  id: string;
  pairing_id: string;
  player1_game_wins: number;
  player2_game_wins: number;
  games_drawn: number;
  outcome: ResultOutcome;
  entered_by: string;
  entered_at: string;
}

export interface ResultInput {
  player1_game_wins: number;
  player2_game_wins: number;
  games_drawn: number;
  outcome: ResultOutcome;
}
