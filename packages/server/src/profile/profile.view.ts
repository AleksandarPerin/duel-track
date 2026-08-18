import type { TournamentPlayerView } from '@dueltrack/shared';

export type GuestPlayerRow = TournamentPlayerView & {
  guest_name: string | null;
  guest_email: string | null;
};

// Built field by field rather than by spreading the selected row: the lookup
// has to read guest_email to verify the match, and spreading would carry it
// straight into the response body.
export function toPlayerView(row: GuestPlayerRow, displayName: string): TournamentPlayerView {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    user_id: row.user_id,
    sort_seed: row.sort_seed,
    byes_received: row.byes_received,
    status: row.status,
    drop_round: row.drop_round,
    created_at: row.created_at,
    display_name: displayName,
  };
}
