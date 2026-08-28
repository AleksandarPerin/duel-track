import type { TournamentAssignmentView } from '@dueltrack/shared';
import { apiRequest } from './client';

export function getMyAssignments(): Promise<TournamentAssignmentView[]> {
  return apiRequest<TournamentAssignmentView[]>('/profile/assignments');
}
