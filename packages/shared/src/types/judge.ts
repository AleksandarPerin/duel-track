export interface TournamentJudge {
  tournament_id: string;
  user_id: string;
  assigned_by: string;
  created_at: string;
}

// Joined view used in API responses
export interface TournamentJudgeView extends TournamentJudge {
  display_name: string;
  email: string;
}
