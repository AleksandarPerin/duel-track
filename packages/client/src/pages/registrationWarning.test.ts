import { describe, it, expect } from 'vitest';
import { registrationWarning } from './TournamentRegistrationsPage';

describe('registrationWarning', () => {
  it("warns when a guest sign-up uses a judge's email", () => {
    expect(registrationWarning({ email_matches_judge: true })).toBe(
      "This email belongs to one of this tournament's judges — check before approving.",
    );
  });

  it('says nothing otherwise', () => {
    expect(registrationWarning({ email_matches_judge: false })).toBeNull();
    expect(registrationWarning({})).toBeNull();
  });
});
