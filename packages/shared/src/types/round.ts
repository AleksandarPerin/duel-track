export type RoundPhase = 'swiss' | 'elimination';
export type RoundStatus = 'pending' | 'active' | 'completed';

export interface Round {
  id: string;
  tournament_id: string;
  round_number: number;
  phase: RoundPhase;
  status: RoundStatus;
  timer_minutes: number;
  started_at?: string;
  ended_at?: string;
}
