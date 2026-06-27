import type { TournamentFormat } from '../types/tournament';

export const MIN_PLAYERS = 8;
export const MAX_PLAYERS = 512;

// Match points — MTR Appendix E
export const MATCH_POINTS_WIN = 3;
export const MATCH_POINTS_DRAW = 1;
export const MATCH_POINTS_LOSS = 0;
export const MATCH_POINTS_BYE = 3; // treated identically to a match win

// Bye game record credit — MTR Appendix E
export const BYE_GAME_WIN_CREDIT = 2;
export const BYE_GAMES_PLAYED_CREDIT = 2;

// Per-opponent MWP floor before averaging — MTR Appendix E
export const OMW_FLOOR = 0.33;
// Player's own GW% floor — MTR Appendix E
export const GW_FLOOR = 0.33;

// Pairing engine edge weights — PRD Section 6.2 Step 4
export const PAIRING_BASE_WEIGHT = 1000;
export const PAIRING_REMATCH_PENALTY = 500;
export const PAIRING_BRACKET_CROSS_PENALTY = 100;

// Blossom algorithm backtracking limit — PRD Section 6.2 Step 8
export const PAIRING_BACKTRACK_LIMIT = 10_000;

// MTR Appendix E round count table
const ROUND_COUNT_TABLE: Array<{ min: number; max: number; rounds: number }> = [
  { min: 8,   max: 8,   rounds: 3 },
  { min: 9,   max: 16,  rounds: 4 },
  { min: 17,  max: 32,  rounds: 5 },
  { min: 33,  max: 64,  rounds: 6 },
  { min: 65,  max: 128, rounds: 7 },
  { min: 129, max: 226, rounds: 8 },
  { min: 227, max: 409, rounds: 9 },
  { min: 410, max: 512, rounds: 10 },
];

export function recommendedRounds(playerCount: number): number {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(
      `Player count ${playerCount} is outside supported range (${MIN_PLAYERS}–${MAX_PLAYERS})`
    );
  }
  const entry = ROUND_COUNT_TABLE.find(
    (r) => playerCount >= r.min && playerCount <= r.max
  );
  // Unreachable given the bounds check above, but satisfies TS
  if (!entry) throw new Error(`No round count entry for ${playerCount} players`);
  return entry.rounds;
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
