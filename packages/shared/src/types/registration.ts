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
