import type { TournamentStatus } from './tournament';
import type { RoundStatus } from './round';

// One row per tournament the caller organizes or judges, together with the
// round they'd most usefully land on next (the active round if there is one,
// otherwise the latest one) — powers the post-login "Your Tournaments" list
// so a judge/organizer never has to know a tournament's URL by heart.
export interface TournamentAssignmentView {
  tournament_id: string;
  tournament_name: string;
  tournament_status: TournamentStatus;
  is_organizer: boolean;
  current_round_number: number | null;
  current_round_status: RoundStatus | null;
}
