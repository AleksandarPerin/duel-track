import { describe, it, expect } from 'vitest';
import { computeStandings } from './standings.engine';
import type { MatchRecord } from './standings.engine';

// ── helpers ──────────────────────────────────────────────────────────────────

function win(round: number, p1: string, p2: string, score: '2-0' | '2-1' = '2-0'): MatchRecord {
  return {
    round_number: round,
    player1_id: p1,
    player2_id: p2,
    is_bye: false,
    player1_game_wins: 2,
    player2_game_wins: score === '2-1' ? 1 : 0,
    games_drawn: 0,
    outcome: 'player1_win',
  };
}

function loss(round: number, p1: string, p2: string, score: '0-2' | '1-2' = '0-2'): MatchRecord {
  return {
    round_number: round,
    player1_id: p1,
    player2_id: p2,
    is_bye: false,
    player1_game_wins: score === '1-2' ? 1 : 0,
    player2_game_wins: 2,
    games_drawn: 0,
    outcome: 'player2_win',
  };
}

function bye(round: number, player: string): MatchRecord {
  return {
    round_number: round,
    player1_id: player,
    player2_id: null,
    is_bye: true,
    player1_game_wins: 0,
    player2_game_wins: 0,
    games_drawn: 0,
    outcome: null,
  };
}

function draw(round: number, p1: string, p2: string): MatchRecord {
  return {
    round_number: round,
    player1_id: p1,
    player2_id: p2,
    is_bye: false,
    player1_game_wins: 1,
    player2_game_wins: 1,
    games_drawn: 1,
    outcome: 'draw',
  };
}

function id(round: number, p1: string, p2: string): MatchRecord {
  return {
    round_number: round,
    player1_id: p1,
    player2_id: p2,
    is_bye: false,
    player1_game_wins: 0,
    player2_game_wins: 0,
    games_drawn: 0,
    outcome: 'intentional_draw',
  };
}

function dml(round: number, p1: string, p2: string): MatchRecord {
  return {
    round_number: round,
    player1_id: p1,
    player2_id: p2,
    is_bye: false,
    player1_game_wins: 0,
    player2_game_wins: 0,
    games_drawn: 0,
    outcome: 'double_loss',
  };
}

function byId(entries: ReturnType<typeof computeStandings>, id: string) {
  return entries.find((e) => e.player_id === id)!;
}

// ── computeStandings ──────────────────────────────────────────────────────────

describe('computeStandings', () => {
  it('returns empty for empty player list', () => {
    expect(computeStandings([], [], 1)).toHaveLength(0);
  });

  it('returns floor defaults for a player with no results', () => {
    const [e] = computeStandings(['A'], [], 1);
    expect(e!.match_points).toBe(0);
    expect(e!.omw_percent).toBe(0.33);
    expect(e!.gw_percent).toBe(0.33);
    expect(e!.ogw_percent).toBe(0.33);
    expect(e!.rank).toBe(1);
  });

  // ── Win / Loss ───────────────────────────────────────────────────────────

  it('correctly scores a 2-0 win', () => {
    const records = [win(1, 'A', 'B', '2-0')];
    const entries = computeStandings(['A', 'B'], records, 1);
    const a = byId(entries, 'A');
    const b = byId(entries, 'B');
    expect(a.match_points).toBe(3);
    expect(a.match_wins).toBe(1);
    expect(a.match_losses).toBe(0);
    expect(a.game_wins).toBe(2);
    expect(a.game_losses).toBe(0);
    expect(b.match_points).toBe(0);
    expect(b.match_losses).toBe(1);
    expect(b.game_wins).toBe(0);
    expect(b.game_losses).toBe(2);
  });

  it('correctly scores a 2-1 win', () => {
    const records = [win(1, 'A', 'B', '2-1')];
    const entries = computeStandings(['A', 'B'], records, 1);
    const a = byId(entries, 'A');
    const b = byId(entries, 'B');
    expect(a.game_wins).toBe(2);
    expect(a.game_losses).toBe(1);
    expect(b.game_wins).toBe(1);
    expect(b.game_losses).toBe(2);
  });

  // ── Bye ──────────────────────────────────────────────────────────────────

  it('credits bye with +3 match points, +2 game wins, +2 games_played', () => {
    const records = [bye(1, 'A')];
    const entries = computeStandings(['A'], records, 1);
    const a = byId(entries, 'A');
    expect(a.match_points).toBe(3);
    expect(a.match_wins).toBe(1);
    expect(a.game_wins).toBe(2);
    expect(a.game_losses).toBe(0);
    // GW% = max(0.33, 2/2) = 1.0
    expect(a.gw_percent).toBe(1.0);
  });

  it('excludes bye round from OMW% opponent list', () => {
    // A has a bye round 1; B has no opponents → OMW%(B) stays at floor.
    // C beats B in round 2. A should not appear as B's opponent.
    const records = [bye(1, 'A'), win(2, 'C', 'B')];
    const entries = computeStandings(['A', 'B', 'C'], records, 2);
    const b = byId(entries, 'B');
    // B's only opponent is C (who went 1-0). MWP(C) = max(0.33, 1/1) = 1.0
    expect(b.omw_percent).toBe(1.0);
  });

  it("excludes bye from player's non_bye_played (does not inflate opponents OMW%)", () => {
    // A beats B. A also has a bye. C faces A.
    // For C's OMW%: A's MWP = non_bye_wins/non_bye_played = 1/1 (only the match vs B counts, not the bye)
    const records = [win(1, 'A', 'B'), bye(2, 'A'), win(3, 'C', 'A')];
    const entries = computeStandings(['A', 'B', 'C'], records, 3);
    const c = byId(entries, 'C');
    // A: non_bye_wins=1 (beat B), non_bye_played=2 (B and C) → MWP(A)=max(0.33,1/2)=0.5
    expect(c.omw_percent).toBe(0.5);
  });

  // ── Draw / ID / DML ──────────────────────────────────────────────────────

  it('scores a 1-1-1 match draw correctly', () => {
    const records = [draw(1, 'A', 'B')];
    const entries = computeStandings(['A', 'B'], records, 1);
    const a = byId(entries, 'A');
    const b = byId(entries, 'B');
    expect(a.match_points).toBe(1);
    expect(a.match_draws).toBe(1);
    expect(a.game_wins).toBe(1);
    expect(a.game_losses).toBe(1);
    expect(b.match_points).toBe(1);
    expect(b.game_wins).toBe(1);
  });

  // The GW% of a drawn game was pinned here at the PRD's 0.3333 (a drawn
  // game counted as 0). MTR Appendix E counts it as 1 game point —
  // (3·1 + 1) / (3·3) = 0.4444 — and draws likewise as 1/3 in opponents'
  // MWP. Not pinned either way until the MTR reading is confirmed (C-1).
  it.todo('GW% and opponents\' MWP of a drawn match follow MTR Appendix E (C-1)');

  it('scores an intentional draw with 0 games recorded', () => {
    const records = [id(1, 'A', 'B')];
    const entries = computeStandings(['A', 'B'], records, 1);
    const a = byId(entries, 'A');
    const b = byId(entries, 'B');
    expect(a.match_points).toBe(1);
    expect(a.match_draws).toBe(1);
    expect(a.game_wins).toBe(0);
    expect(a.game_losses).toBe(0);
    // GW% = floor (0 games played)
    expect(a.gw_percent).toBe(0.33);
    expect(b.match_points).toBe(1);
  });

  it('scores a double match loss with 0 wins and 2 game losses each', () => {
    const records = [dml(1, 'A', 'B')];
    const entries = computeStandings(['A', 'B'], records, 1);
    const a = byId(entries, 'A');
    const b = byId(entries, 'B');
    expect(a.match_points).toBe(0);
    expect(a.match_losses).toBe(1);
    expect(a.game_wins).toBe(0);
    expect(a.game_losses).toBe(2);
    // GW% = max(0.33, 0/2) = 0.33
    expect(a.gw_percent).toBe(0.33);
    expect(b.match_losses).toBe(1);
    expect(b.game_losses).toBe(2);
  });

  // ── OMW% floor per-opponent (the critical MTR rule) ──────────────────────

  it("applies the 0.33 floor to each opponent's MWP individually, not to the average", () => {
    // 4 players, 2 rounds
    // R1: A beats D (2-0), B beats C (2-0)
    // R2: A beats B (2-0), C beats D (2-0)
    //
    // A's opponents: D (0 wins in 2 played → MWP=0.33 floored) and B (1 win in 2 played → MWP=0.5)
    // Correct  OMW%(A) = (0.33 + 0.5) / 2 = 0.415
    // Incorrect (floor on avg) = max(0.33, (0 + 0.5)/2) = max(0.33, 0.25) = 0.33 ← WRONG
    const records = [
      win(1, 'A', 'D'), win(1, 'B', 'C'),
      win(2, 'A', 'B'), win(2, 'C', 'D'),
    ];
    const entries = computeStandings(['A', 'B', 'C', 'D'], records, 2);
    const a = byId(entries, 'A');
    expect(a.omw_percent).toBe(0.415);
  });

  it("floors each opponent's MWP at 0.33 before averaging", () => {
    // A beats B and C. Both B and C go 0-2 (all losses).
    // MWP(B) = MWP(C) = max(0.33, 0/2) = 0.33
    // OMW%(A) = (0.33 + 0.33) / 2 = 0.33
    const records = [
      win(1, 'A', 'B'), win(1, 'X', 'C'),
      win(2, 'A', 'C'), win(2, 'X', 'B'),
    ];
    const entries = computeStandings(['A', 'B', 'C', 'X'], records, 2);
    const a = byId(entries, 'A');
    expect(a.omw_percent).toBe(0.33);
  });

  // ── OGW% ─────────────────────────────────────────────────────────────────

  it('computes OGW% as mean of opponent GW% values', () => {
    // A beats B (2-0) and C (2-0). B beats D (2-0). C loses to D (0-2).
    // GW%(B) = max(0.33, 2/4) = 0.5 (2 wins in 4 games)
    // GW%(C) = max(0.33, 2/4) = 0.5 (beat D 2-0, lost to A 0-2)
    // OGW%(A) = (GW%(B) + GW%(C)) / 2 = (0.5 + 0.5) / 2 = 0.5
    const records = [
      win(1, 'A', 'B'), win(1, 'C', 'D'),
      win(2, 'A', 'C'), win(2, 'B', 'D'),
    ];
    const entries = computeStandings(['A', 'B', 'C', 'D'], records, 2);
    const a = byId(entries, 'A');
    expect(a.ogw_percent).toBe(0.5);
  });

  // ── Ranking ──────────────────────────────────────────────────────────────

  it('ranks by match_points DESC first', () => {
    const records = [win(1, 'A', 'B'), win(2, 'A', 'C'), win(3, 'A', 'D')];
    // Add some rounds between others too (B, C, D must have opponents)
    const ids = ['A', 'B', 'C', 'D'];
    const r = computeStandings(ids, records, 3);
    expect(byId(r, 'A').rank).toBe(1);
    expect(byId(r, 'A').match_points).toBe(9);
  });

  it('assigns sequential ranks (no shared ranks)', () => {
    const records = [win(1, 'A', 'B'), win(1, 'C', 'D')];
    const r = computeStandings(['A', 'B', 'C', 'D'], records, 1);
    const ranks = r.map((e) => e.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  // ── throughRound filter ───────────────────────────────────────────────────

  it('ignores records beyond throughRound', () => {
    const records = [win(1, 'A', 'B'), win(2, 'A', 'C')];
    const after1 = computeStandings(['A', 'B', 'C'], records, 1);
    expect(byId(after1, 'A').match_points).toBe(3);
    const after2 = computeStandings(['A', 'B', 'C'], records, 2);
    expect(byId(after2, 'A').match_points).toBe(6);
  });

  // ── Cumulative multi-round ────────────────────────────────────────────────

  it('accumulates stats correctly across multiple rounds', () => {
    // A beats B round 1 (2-0), then draws with C round 2 (1-1-1)
    const records = [win(1, 'A', 'B'), draw(2, 'A', 'C')];
    const entries = computeStandings(['A', 'B', 'C'], records, 2);
    const a = byId(entries, 'A');
    expect(a.match_points).toBe(4); // 3 + 1
    expect(a.match_wins).toBe(1);
    expect(a.match_draws).toBe(1);
    expect(a.game_wins).toBe(3); // 2 (vs B) + 1 (vs C draw)
    expect(a.game_losses).toBe(1); // 0 (vs B) + 1 (vs C draw)
  });

  // ── Dropped player ────────────────────────────────────────────────────────

  it("includes dropped player results in opponents' tiebreakers", () => {
    // A beats B (who later "drops"). C faces A.
    // B's record: 0 wins, 1 loss (frozen). MWP(B) = 0.33.
    // OMW%(A) considers B's MWP.
    const records = [win(1, 'A', 'B'), win(2, 'A', 'C')];
    // B has no more results after round 1 (dropped)
    const entries = computeStandings(['A', 'B', 'C'], records, 2);
    const a = byId(entries, 'A');
    // B: non_bye_wins=0, non_bye_played=1 → MWP=0.33
    // C: non_bye_wins=0, non_bye_played=1 → MWP=0.33
    expect(a.omw_percent).toBe(0.33);
  });

  // ── GW% floor ────────────────────────────────────────────────────────────

  it('applies GW% floor for player with 0 games played (all IDs)', () => {
    const records = [id(1, 'A', 'B')];
    const entries = computeStandings(['A', 'B'], records, 1);
    expect(byId(entries, 'A').gw_percent).toBe(0.33);
  });

  it('applies GW% floor for player with 0 game wins', () => {
    const records = [loss(1, 'A', 'B', '0-2')];
    const entries = computeStandings(['A', 'B'], records, 1);
    expect(byId(entries, 'A').gw_percent).toBe(0.33);
  });

  it('does not apply GW% floor when player has wins', () => {
    const records = [win(1, 'A', 'B', '2-0')];
    const entries = computeStandings(['A', 'B'], records, 1);
    expect(byId(entries, 'A').gw_percent).toBe(1.0);
  });
});

describe('computeStandings — OGW% of a player with a single opponent', () => {
  // B played only round 1 (lost 1-2 to A), then left. MTR Appendix E: OGW%
  // is the mean of the opponents' GW% — for B, just A's: A won 4 of 5 games.
  it("is that one opponent's GW%", () => {
    const records = [win(1, 'A', 'B', '2-1'), win(2, 'A', 'C')];
    const b = computeStandings(['A', 'B', 'C'], records, 2).find((s) => s.player_id === 'B')!;
    expect(b.ogw_percent).toBe(0.8);
  });
});

// ── Tiebreaker order (MTR Appendix E) ────────────────────────────────────────
// Order: match points, then OMW%, then GW%, then OGW%, all descending.
// Expected values were computed independently from the MTR Appendix E
// formulas (match points / 3·rounds, game points / 3·games, 0.33 floor per
// opponent), not by this engine. The fixture has no draws and no byes —
// the cases where this engine's PRD-based draw/bye handling is still
// unconfirmed against the MTR — so here the two must agree.
describe('computeStandings — tiebreaker order', () => {
  // [player1, player2, player1 game wins, player2 game wins, round]
  const event: [string, string, number, number, number][] = [
    ['g', 'c', 2, 1, 1], ['b', 'h', 0, 2, 1], ['f', 'a', 2, 1, 1], ['d', 'e', 0, 2, 1],
    ['d', 'a', 2, 1, 2], ['b', 'g', 2, 0, 2], ['h', 'f', 2, 0, 2], ['c', 'e', 2, 0, 2],
    ['a', 'b', 0, 2, 3], ['c', 'd', 2, 1, 3], ['g', 'f', 2, 1, 3], ['h', 'e', 1, 2, 3],
  ];
  const records = event.map(([x, y, gx, gy, r]) =>
    gx > gy ? win(r, x, y, gy === 1 ? '2-1' : '2-0') : loss(r, x, y, gx === 1 ? '1-2' : '0-2'),
  );
  const standings = computeStandings('abcdefgh'.split(''), records, 3);
  const row = (p: string) => standings.find((s) => s.player_id === p)!;

  it('ranks the whole field in tiebreaker order', () => {
    expect(standings.map((s) => s.player_id)).toEqual(['h', 'c', 'e', 'g', 'b', 'f', 'd', 'a']);
  });

  it('puts OMW% before GW%: b has the better GW% but the lower OMW%', () => {
    // c: OMW 0.5556, GW 0.625 — b: OMW 0.5544, GW 0.6667 (both 6 points)
    expect(row('c')).toMatchObject({ match_points: 6, omw_percent: 0.5556, gw_percent: 0.625 });
    expect(row('b')).toMatchObject({ match_points: 6, omw_percent: 0.5544, gw_percent: 0.6667 });
    expect(row('c').rank).toBeLessThan(row('b').rank);
  });

  it('breaks an OMW% tie by GW%, highest first', () => {
    // h, c, e, g: all OMW 0.5556 on 6 points
    expect(['h', 'c', 'e', 'g'].map((p) => row(p).gw_percent)).toEqual([0.7143, 0.625, 0.5714, 0.5]);
    expect(['h', 'c', 'e', 'g'].map((p) => row(p).rank)).toEqual([1, 2, 3, 4]);
  });

  it('breaks an OMW% and GW% tie by OGW%, highest first', () => {
    // f and d: 3 points, OMW 0.5544, GW 0.375 — OGW 0.5148 vs 0.5088
    expect(row('f')).toMatchObject({ match_points: 3, omw_percent: 0.5544, gw_percent: 0.375, ogw_percent: 0.5148 });
    expect(row('d')).toMatchObject({ match_points: 3, omw_percent: 0.5544, gw_percent: 0.375, ogw_percent: 0.5088 });
    expect(row('f').rank).toBe(6);
    expect(row('d').rank).toBe(7);
  });
});
