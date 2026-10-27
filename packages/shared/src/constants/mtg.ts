import type { TournamentFormat } from '../types/tournament';

export const MIN_PLAYERS = 8;
export const MAX_PLAYERS = 512;

// Match points — MTR Appendix C
export const MATCH_POINTS_WIN = 3;
export const MATCH_POINTS_DRAW = 1;
export const MATCH_POINTS_LOSS = 0;
export const MATCH_POINTS_BYE = 3; // treated identically to a match win

// Bye game record credit — MTR Appendix C
export const BYE_GAME_WIN_CREDIT = 2;
export const BYE_GAMES_PLAYED_CREDIT = 2;

// Per-opponent MWP floor before averaging — MTR Appendix C
export const OMW_FLOOR = 0.33;
// Player's own GW% floor — MTR Appendix C
export const GW_FLOOR = 0.33;

// Pairing engine edge weights — PRD Section 6.2 Step 4
export const PAIRING_BASE_WEIGHT = 1000;
export const PAIRING_REMATCH_PENALTY = 500;
export const PAIRING_BRACKET_CROSS_PENALTY = 100;

// Blossom algorithm backtracking limit — PRD Section 6.2 Step 8
export const PAIRING_BACKTRACK_LIMIT = 10_000;

// MTR (27 February 2026) Appendix E — Recommended Number of Rounds in Swiss
// Tournaments. Required for Premier tournaments; "may be used at the
// Tournament Organizer's discretion for non-Premier tournaments", which is why
// DuelTrack still lets an 8-player event run Swiss rounds.
export type RoundRecommendation =
  | { swissRounds: 0; playoff: 'single-elimination'; singleEliminationRounds: number }
  | { swissRounds: number; playoff: 'top-4' | 'top-8' };

// 17+ players: Swiss rounds, then Top 8
const SWISS_ROUND_TABLE: Array<{ min: number; max: number; rounds: number }> = [
  { min: 17,  max: 32,  rounds: 5 },
  { min: 33,  max: 64,  rounds: 6 },
  { min: 65,  max: 128, rounds: 7 },
  { min: 129, max: 226, rounds: 8 },
  { min: 227, max: 409, rounds: 9 },
  { min: 410, max: Infinity, rounds: 10 },
];

// boosterDraftTop8: the Top 8 is a booster draft ("Limited Format with Booster
// Draft in Playoff") — a property of the playoff, not the Swiss format.
export function recommendedRounds(
  playerCount: number,
  { boosterDraftTop8 = false }: { boosterDraftTop8?: boolean } = {},
): RoundRecommendation {
  if (playerCount < 5 || playerCount > MAX_PLAYERS) {
    throw new Error(`No MTR round recommendation for ${playerCount} players (5–${MAX_PLAYERS})`);
  }
  if (playerCount <= 8) return { swissRounds: 0, playoff: 'single-elimination', singleEliminationRounds: 3 };
  if (playerCount <= 16) {
    return boosterDraftTop8 ? { swissRounds: 4, playoff: 'top-8' } : { swissRounds: 5, playoff: 'top-4' };
  }
  const entry = SWISS_ROUND_TABLE.find((r) => playerCount >= r.min && playerCount <= r.max)!;
  return { swissRounds: entry.rounds, playoff: 'top-8' };
}

// Default round timers per format — Constructed 50 min, Limited 60 min
export const DEFAULT_ROUND_TIMER: Record<TournamentFormat, number> = {
  standard: 50,
  pioneer: 50,
  modern: 50,
  legacy: 50,
  vintage: 50,
  draft: 60,
  sealed: 60,
};
