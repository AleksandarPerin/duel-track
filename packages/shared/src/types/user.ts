export type UserRole = 'player' | 'judge' | 'organizer' | 'admin';

// DB row type — password_hash and token_version never leave the auth layer
export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null; // null for OAuth2 users
  wpn_number?: string;
  role: UserRole;
  token_version: number;
  profile_public: boolean;
  created_at: string;
}

// Safe API response type — password_hash stripped at the service boundary
export interface User {
  id: string;
  email: string;
  display_name: string;
  wpn_number?: string;
  role: UserRole;
  profile_public: boolean;
  created_at: string;
}
