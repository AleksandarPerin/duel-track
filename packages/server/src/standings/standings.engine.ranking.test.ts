import { describe, it, expect } from 'vitest';
import { computeStandings } from './standings.engine';
import type { MatchRecord } from './standings.engine';

// Tiebreakers are compared exactly, not as the 4-dp values that are stored
// and shown. Both fixtures were found by searching random events with an
// exact-fraction implementation of MTR Appendix C (not this engine). They are
// engine inputs, not realistic events: the second has rematches and 0-0-1
// draws that the results API would not accept.

// [player1, player2, p1 game wins, p2 game wins, drawn games]; outcome from the score.
type Row = [string, string, number, number, number];
function records(rounds: Row[][]): MatchRecord[] {
  return rounds.flatMap((rows, i) => rows.map(([a, b, ga, gb, gd]) => ({
    round_number: i + 1, player1_id: a, player2_id: b, is_bye: false,
    player1_game_wins: ga, player2_game_wins: gb, games_drawn: gd,
    outcome: ga > gb ? 'player1_win' as const : gb > ga ? 'player2_win' as const : 'draw' as const,
  })));
}
const rank = (standings: ReturnType<typeof computeStandings>, p: string) =>
  standings.find((s) => s.player_id === p)!.rank;

describe('tiebreaker precision', () => {
  it('treats exactly equal OMW% as a tie and goes on to GW%, despite floating-point sums', () => {
    // A and I: 6 points, OMW% exactly 287/600 each (summed in a different
    // order, the floats differ in the last bits). I has the better GW%
    // (0.5 vs 0.4545), so I ranks above A.
    const players = 'ABCDEFGHIJKL'.split('');
    const s = computeStandings(players, records([
      [['H', 'E', 1, 2, 0], ['J', 'I', 1, 2, 0], ['A', 'K', 1, 2, 0], ['B', 'C', 1, 2, 0], ['G', 'F', 2, 0, 0], ['L', 'D', 2, 0, 0]],
      [['D', 'G', 1, 2, 0], ['C', 'J', 0, 2, 0], ['K', 'E', 2, 0, 0], ['B', 'I', 0, 2, 0], ['F', 'L', 2, 0, 0], ['A', 'H', 2, 1, 0]],
      [['J', 'K', 1, 1, 1], ['D', 'A', 2, 0, 0], ['H', 'I', 2, 0, 0], ['G', 'E', 1, 2, 0], ['B', 'L', 0, 2, 0], ['C', 'F', 1, 2, 0]],
      [['C', 'J', 1, 2, 0], ['D', 'F', 1, 2, 0], ['G', 'B', 2, 0, 0], ['I', 'A', 1, 2, 0], ['K', 'L', 0, 2, 0], ['H', 'E', 2, 1, 0]],
    ]), 4);
    expect(s.find((x) => x.player_id === 'A')).toMatchObject({ match_points: 6, omw_percent: 0.4783, gw_percent: 0.4545 });
    expect(s.find((x) => x.player_id === 'I')).toMatchObject({ match_points: 6, omw_percent: 0.4783, gw_percent: 0.5 });
    expect(rank(s, 'I')).toBeLessThan(rank(s, 'A'));
  });

  it('orders by exact OGW% when the 4-dp values tie', () => {
    // p9 and p15: 7 points, OMW% 7/15, GW% 19/39, OGW% 557/1170 = 0.476068
    // vs 35743/75075 = 0.476097 — both shown as 0.4761. p15 ranks above p9.
    const p = (i: number) => `p${i}`;
    const raw: number[][][] = SCHEDULE;
    const s = computeStandings(
      Array.from({ length: 24 }, (_, i) => p(i)),
      records(raw.map((rows) => rows.map(([a, b, ga, gb, gd]) => [p(a!), p(b!), ga!, gb!, gd!] as Row))),
      5,
    );
    const nine = s.find((x) => x.player_id === 'p9')!;
    const fifteen = s.find((x) => x.player_id === 'p15')!;
    expect([nine.match_points, nine.omw_percent, nine.gw_percent, nine.ogw_percent])
      .toEqual([fifteen.match_points, fifteen.omw_percent, fifteen.gw_percent, fifteen.ogw_percent]);
    expect(nine.ogw_percent).toBe(0.4761);
    expect(fifteen.rank).toBeLessThan(nine.rank);
  });
});

// 24 players, 5 rounds: [player1, player2, p1 game wins, p2 game wins, drawn games].
const SCHEDULE: number[][][] = [
  [[16,  2,  0,  2,  0],  [19,  14,  1,  2,  0],  [8,  23,  1,  1,  1],  [0,  1,  1,  2,  0],  [13,  10,  2,  1,  0],  [18,  17,  2,  0,  0],  [3,  11,  0,  0,  1],  [7,  6,  2,  1,  0],  [9,  4,  1,  1,  1],  [15,  21,  2,  1,  0],  [5,  20,  2,  0,  0],  [12,  22,  2,  1,  0]],
  [[12,  15,  1,  1,  1],  [21,  4,  2,  1,  0],  [6,  8,  1,  2,  0],  [2,  22,  0,  0,  1],  [17,  11,  1,  2,  0],  [0,  18,  2,  0,  0],  [10,  3,  2,  1,  0],  [23,  16,  2,  0,  0],  [14,  7,  2,  0,  0],  [5,  13,  0,  0,  1],  [20,  1,  1,  1,  1],  [19,  9,  2,  1,  0]],
  [[6,  14,  0,  2,  0],  [11,  1,  0,  0,  1],  [12,  19,  2,  0,  0],  [5,  4,  1,  1,  1],  [0,  20,  1,  1,  1],  [23,  21,  0,  2,  0],  [8,  2,  2,  1,  0],  [13,  17,  2,  1,  0],  [16,  9,  0,  2,  0],  [18,  10,  1,  2,  0],  [7,  22,  0,  0,  1],  [3,  15,  0,  2,  0]],
  [[16,  21,  2,  1,  0],  [20,  0,  1,  2,  0],  [18,  15,  2,  1,  0],  [9,  8,  2,  1,  0],  [7,  10,  2,  1,  0],  [12,  1,  1,  1,  1],  [6,  3,  1,  2,  0],  [5,  23,  1,  1,  1],  [13,  22,  2,  0,  0],  [2,  4,  0,  2,  0],  [14,  11,  2,  1,  0],  [19,  17,  0,  0,  1]],
  [[17,  2,  2,  0,  0],  [0,  20,  0,  0,  1],  [11,  19,  1,  1,  1],  [14,  3,  0,  0,  1],  [16,  15,  2,  0,  0],  [13,  21,  0,  2,  0],  [9,  5,  0,  2,  0],  [23,  10,  1,  2,  0],  [6,  1,  2,  1,  0],  [7,  4,  2,  0,  0],  [12,  8,  1,  2,  0],  [18,  22,  1,  1,  1]],
];
