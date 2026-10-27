import { describe, it, expect } from 'vitest';
import { recommendedRounds } from './mtg';

// MTR (27 February 2026) Appendix E — Recommended Number of Rounds in Swiss
// Tournaments. Required for Premier tournaments; "may be used at the
// Tournament Organizer's discretion for non-Premier tournaments".
describe('recommendedRounds — MTR Appendix E', () => {
  it('recommends 3 single-elimination rounds and no Swiss for 5–8 players', () => {
    for (const n of [5, 8]) {
      expect(recommendedRounds(n)).toEqual({ swissRounds: 0, playoff: 'single-elimination', singleEliminationRounds: 3 });
    }
  });

  // "4 (if Limited Format with Booster Draft in Playoff) / 5 (All Other
  // Formats)": the condition is that the Top 8 drafts again, whatever the
  // Swiss format (classically Swiss Sealed, then a Top 8 booster draft).
  it('recommends 4 rounds and a Top 8 for 9–16 players when the Top 8 is a booster draft', () => {
    for (const n of [9, 16]) {
      expect(recommendedRounds(n, { boosterDraftTop8: true })).toEqual({ swissRounds: 4, playoff: 'top-8' });
    }
  });

  it('recommends 5 rounds and a Top 4 for 9–16 players otherwise', () => {
    expect(recommendedRounds(9)).toEqual({ swissRounds: 5, playoff: 'top-4' });
    expect(recommendedRounds(16, { boosterDraftTop8: false })).toEqual({ swissRounds: 5, playoff: 'top-4' });
  });

  it.each([
    [17, 5], [32, 5], [33, 6], [64, 6], [65, 7], [128, 7], [129, 8], [226, 8], [227, 9], [409, 9], [410, 10], [512, 10],
  ])('recommends Top 8 after the table\'s Swiss rounds for %i players: %i', (n, rounds) => {
    expect(recommendedRounds(n)).toEqual({ swissRounds: rounds, playoff: 'top-8' });
  });

  it('has no recommendation below 5 players (4 is for team events only)', () => {
    expect(() => recommendedRounds(4)).toThrow();
  });
});
