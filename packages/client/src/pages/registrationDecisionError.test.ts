import { describe, it, expect } from 'vitest';
import { decisionErrorMessage } from './TournamentRegistrationsPage';

describe('decisionErrorMessage', () => {
  it('tells the organizer a judge cannot be approved as a player', () => {
    expect(decisionErrorMessage('PLAYER_IS_JUDGE')).toBe(
      'This person is a judge for this tournament — remove them as a judge first, or reject the registration.',
    );
  });
});
