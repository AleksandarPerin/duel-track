export type PlayerStatus = 'active' | 'dropped' | 'disqualified';

export interface TournamentPlayer {
  id: string;
  tournament_id: string;
  user_id?: string;
  guest_name?: string;
  guest_email?: string;
  sort_seed: number;
  byes_received: number;
  status: PlayerStatus;
  drop_round?: number;
  created_at: string;
}

// Joined view used in API responses
export interface TournamentPlayerView extends TournamentPlayer {
  display_name: string; // user.display_name or guest_name
}
