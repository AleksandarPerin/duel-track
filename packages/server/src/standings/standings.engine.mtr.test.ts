import { describe, it, expect } from 'vitest';
import { computeStandings } from './standings.engine';
import type { MatchRecord, Outcome } from './standings.engine';

// Expected values here come from the Magic Tournament Rules, 27 February 2026
// release (https://media.wizards.com/ContentResources/WPN/MTG_MTR_2026_Feb27_EN.pdf),
// never from this engine or the PRD:
//   - Appendix C's own worked examples, where one exists (cited per test);
//   - otherwise an independent implementation of the Appendix C formulas
//     (MWP = match points / 3·rounds, GWP = game points / 3·games, 0.33 floor
//     per player, byes a 2-0 win in the receiver's own percentages and absent
//     from their opponent list). The same values are in the DuelTrack
//     Tiebreaker Oracle Sheet, sent to a judge on 2026-10-27 (no reply yet).

// [player1, player2 | null (bye), p1 game wins, p2 game wins, drawn games, outcome?]
type Row = [string, string | null, number, number, number, Outcome?];

function rec(round: number, [p1, p2, g1, g2, gd, outcome]: Row): MatchRecord {
  if (p2 === null) {
    return {
      round_number: round, player1_id: p1, player2_id: null, is_bye: true,
      player1_game_wins: 0, player2_game_wins: 0, games_drawn: 0, outcome: null,
    };
  }
  return {
    round_number: round, player1_id: p1, player2_id: p2, is_bye: false,
    player1_game_wins: g1, player2_game_wins: g2, games_drawn: gd,
    outcome: outcome ?? (g1 > g2 ? 'player1_win' : g2 > g1 ? 'player2_win' : 'draw'),
  };
}

function standings(players: string, rounds: Row[][]) {
  const records = rounds.flatMap((rows, i) => rows.map((r) => rec(i + 1, r)));
  const result = computeStandings(players.split(''), records, rounds.length);
  return (p: string) => result.find((s) => s.player_id === p)!;
}

// MWP is not a stored column; a player whose only opponent is Y has
// OMW% = MWP(Y), which is how these tests observe it.

describe('MTR Appendix C — match-win percentage', () => {
  it('counts a drawn match as 1 of 3 points: 5-2-1 over 8 rounds is 16/24 = 0.667 (App. C example)', () => {
    const row = standings('XYabcdefg', [
      [['Y', 'X', 2, 0, 0], ['a', 'b', 2, 0, 0], ['c', 'd', 2, 0, 0], ['e', 'f', 2, 0, 0]],
      [['Y', 'a', 2, 0, 0]],
      [['Y', 'b', 2, 0, 0]],
      [['Y', 'c', 2, 0, 0]],
      [['Y', 'd', 2, 0, 0]],
      [['e', 'Y', 2, 0, 0]],
      [['f', 'Y', 2, 0, 0]],
      [['Y', 'g', 1, 1, 1]],
    ]);
    expect(row('Y')).toMatchObject({ match_wins: 5, match_losses: 2, match_draws: 1, match_points: 16 });
    expect(row('X').omw_percent).toBe(0.6667);
  });

  it('counts a bye as a 3-point round: 3-2-0 with a first-round bye, then withdraws, is 9/15 = 0.60 (App. C example)', () => {
    const row = standings('XYab', [
      [['Y', null, 0, 0, 0], ['a', 'b', 2, 0, 0]],
      [['Y', 'X', 2, 0, 0]],
      [['Y', 'b', 2, 0, 0]],
      [['a', 'Y', 2, 0, 0]],
      [['b', 'Y', 2, 0, 0]],
    ]);
    expect(row('Y').match_points).toBe(9);
    expect(row('X').omw_percent).toBe(0.6);
  });

  it('floors a 1-3-0 record that withdraws after 4 rounds at 0.33 (App. C example: 3/12 = 0.25)', () => {
    const row = standings('XYabc', [
      [['Y', 'X', 2, 0, 0]],
      [['a', 'Y', 2, 0, 0]],
      [['b', 'Y', 2, 0, 0]],
      [['c', 'Y', 2, 0, 0]],
    ]);
    expect(row('X').omw_percent).toBe(0.33);
  });
});

describe('MTR Appendix C — game-win percentage', () => {
  it('is 21/30 = 0.70 for 2-0, 2-1, 1-2, 2-0 (App. C example)', () => {
    const row = standings('Pabcd', [
      [['P', 'a', 2, 0, 0]], [['P', 'b', 2, 1, 0]], [['P', 'c', 1, 2, 0]], [['P', 'd', 2, 0, 0]],
    ]);
    expect(row('P').gw_percent).toBe(0.7);
  });

  it('floors 9/33 = 0.27 at 0.33 for 1-2, 1-2, 0-2, 1-2 (App. C example)', () => {
    const row = standings('Pabcd', [
      [['P', 'a', 1, 2, 0]], [['P', 'b', 1, 2, 0]], [['P', 'c', 0, 2, 0]], [['P', 'd', 1, 2, 0]],
    ]);
    expect(row('P').gw_percent).toBe(0.33);
  });

  it('gives a drawn game 1 game point: a 2-0-1 win earns 7 of 9 (App. C, Game Points example)', () => {
    const row = standings('AB', [[['A', 'B', 2, 0, 1]]]);
    expect(row('A').gw_percent).toBe(0.7778);
  });

  it('gives each player of a 1-1-1 draw (3 + 1) / 9 = 0.4444 (oracle sheet example 1)', () => {
    const row = standings('AB', [[['A', 'B', 1, 1, 1]]]);
    expect(row('A')).toMatchObject({ gw_percent: 0.4444, ogw_percent: 0.4444 });
    expect(row('B')).toMatchObject({ gw_percent: 0.4444, ogw_percent: 0.4444 });
  });
});

describe('MTR §2.5 — intentional draw with no games played is reported 0-0-3', () => {
  // Round 1: A beat B 2-0, C beat D 2-0. Round 2: A and C ID; B beat D 2-0.
  const row = standings('ABCD', [
    [['A', 'B', 2, 0, 0], ['C', 'D', 2, 0, 0]],
    [['A', 'C', 0, 0, 0, 'intentional_draw'], ['B', 'D', 2, 0, 0]],
  ]);

  it('adds three drawn games: A has (6 + 3) / 15 = 0.60 (oracle sheet example 5)', () => {
    expect(row('A').gw_percent).toBe(0.6);
    expect(row('C').gw_percent).toBe(0.6);
  });

  it("feeds the 0-0-3 game record and the drawn match point into opponents' percentages", () => {
    // B's opponents: A (4/6, GW 0.6) and D (0/6 → 0.33, GW 0.33)
    expect(row('B')).toMatchObject({ omw_percent: 0.4983, ogw_percent: 0.465 });
  });

  it('leaves a player whose only match was an ID just above the floor: 3/9 = 0.3333', () => {
    const only = standings('AB', [[['A', 'B', 0, 0, 0, 'intentional_draw']]]);
    expect(only('A')).toMatchObject({ match_points: 1, gw_percent: 0.3333, omw_percent: 0.3333 });
  });
});

// The MTR does not cover double losses: a match loss is 0 points (App. C) and
// WER recorded a double match loss as 0-2 for each player (Magic Judges
// forum, 2019). Here the double loss is not the players' only match, so the
// 0.33 floors cannot hide it.
describe('double loss among other results', () => {
  // Round 1: A beat X 2-0, B beat Y 2-0. Round 2: A and B take a double loss.
  const row = standings('ABXY', [
    [['A', 'X', 2, 0, 0], ['B', 'Y', 2, 0, 0]],
    [['A', 'B', 0, 0, 0, 'double_loss']],
  ]);

  it('adds two lost games to each player: A and B have 6 / (3 × 4) = 0.50', () => {
    expect(row('A')).toMatchObject({ match_points: 3, match_losses: 1, gw_percent: 0.5 });
    expect(row('B')).toMatchObject({ match_points: 3, match_losses: 1, gw_percent: 0.5 });
  });

  it('counts the round in MWP: X, whose only opponent is A, sees 3 / (3 × 2) = 0.50', () => {
    expect(row('X').omw_percent).toBe(0.5);
  });

  it("makes the players each other's opponents: B's OMW% is (0.33 for Y + 0.50 for A) / 2 = 0.415", () => {
    expect(row('B').omw_percent).toBe(0.415);
  });
});

describe('MTR Appendix C — byes', () => {
  // Round 1: A bye; B beat C 2-0. Round 2: A beat B 2-1; C bye.
  const row = standings('ABC', [
    [['A', null, 0, 0, 0], ['B', 'C', 2, 0, 0]],
    [['A', 'B', 2, 1, 0], ['C', null, 0, 0, 0]],
  ]);

  it("counts an opponent's bye in their MWP: B's opponents C (3/6) and A (6/6) average 0.75 (oracle sheet example 4)", () => {
    expect(row('B').omw_percent).toBe(0.75);
  });

  it("ignores the bye round in the receiver's own opponent list: A's only opponent is B (3/6)", () => {
    expect(row('A').omw_percent).toBe(0.5);
  });

  it("counts the bye as 2-0 in the receiver's own GW%: A has (6 + 6) / 15 = 0.80", () => {
    expect(row('A').gw_percent).toBe(0.8);
  });
});

describe('MTR Appendix C — draws in opponents\' percentages (oracle sheet example 2)', () => {
  const row = standings('PQRS', [
    [['P', 'Q', 2, 0, 0], ['R', 'S', 2, 0, 0]],
    [['P', 'R', 1, 1, 1], ['Q', 'S', 2, 0, 0]],
    [['S', 'P', 2, 0, 0], ['R', 'Q', 2, 0, 0]],
  ]);

  it.each([
    ['R', 7, 0.3704, 0.7619, 0.381],
    ['P', 4, 0.4815, 0.4762, 0.4762],
    ['Q', 3, 0.5185, 0.3333, 0.5238],
    ['S', 3, 0.5185, 0.3333, 0.5238],
  ])('%s: %d points, OMW %f, GW %f, OGW %f', (p, mp, omw, gw, ogw) => {
    expect(row(p)).toMatchObject({ match_points: mp, omw_percent: omw, gw_percent: gw, ogw_percent: ogw });
  });
});

describe('MTR Appendix C — a drawn match between two opponents decides 1st place (oracle sheet example 3)', () => {
  const row = standings('ABCDEF', [
    [['B', 'A', 2, 1, 0], ['C', 'D', 2, 0, 0], ['E', 'F', 2, 1, 0]],
    [['F', 'C', 2, 1, 0], ['A', 'D', 2, 1, 0], ['B', 'E', 2, 1, 0]],
    [['D', 'F', 2, 1, 0], ['A', 'E', 1, 1, 1], ['C', 'B', 2, 1, 0]],
  ]);

  it("ranks B 1st on OMW% (A, E, C have 4, 4 and 6 of 9 points: 0.5185) over C (0.4444)", () => {
    expect(row('B')).toMatchObject({ match_points: 6, omw_percent: 0.5185, gw_percent: 0.5556, rank: 1 });
    expect(row('C')).toMatchObject({ match_points: 6, omw_percent: 0.4444, gw_percent: 0.625, rank: 2 });
  });
});
