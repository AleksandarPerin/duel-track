export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export interface TournamentRegistration {
  id: string;
  tournament_id: string;
  user_id?: string;
  guest_name?: string;
  guest_email?: string;
  status: RegistrationStatus;
  decided_by?: string;
  decided_at?: string;
  created_at: string;
}

// Joined view used in API responses
export interface TournamentRegistrationView extends TournamentRegistration {
  display_name: string; // user.display_name or guest_name
}

// Response shape for GET /api/public/register/:token — deliberately excludes
// registration_token, organizer_id, and any other field a public,
// unauthenticated caller shouldn't see.
export interface PublicTournamentInfo {
  id: string;
  name: string;
  format: string;
  rel_level: string;
  venue: string | null;
  scheduled_at: string | null;
  status: string;
}
