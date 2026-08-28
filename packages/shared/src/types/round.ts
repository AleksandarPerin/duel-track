export type RoundPhase = 'swiss' | 'elimination';
export type RoundStatus = 'pending' | 'active' | 'completed';

export interface Round {
  id: string;
  tournament_id: string;
  round_number: number;
  phase: RoundPhase;
  status: RoundStatus;
  timer_minutes: number;
  // Nullable, not just optional: Postgres NULL always serializes as JSON
  // null over the wire, never an absent key — `pg` includes every column.
  started_at?: string | null;
  ended_at?: string | null;
}
