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

  it("counts a player's bye in their MWP as opponents see it (MTR App. C)", () => {
    // A beats B, has a bye, loses to C. C's only opponent is A.
    // MWP(A) = 6 match points / (3 × 3 rounds) = 0.6667 — the bye is a 3-point round.
    const records = [win(1, 'A', 'B'), bye(2, 'A'), win(3, 'C', 'A')];
    const entries = computeStandings(['A', 'B', 'C'], records, 3);
    const c = byId(entries, 'C');
    expect(c.omw_percent).toBe(0.6667);
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

  // GW% and OMW% of drawn matches and games are pinned against the MTR in
  // standings.engine.mtr.test.ts.

  it('scores an intentional draw with 0 games recorded as 0-0-3 (MTR §2.5)', () => {
    const records = [id(1, 'A', 'B')];
    const entries = computeStandings(['A', 'B'], records, 1);
    const a = byId(entries, 'A');
    const b = byId(entries, 'B');
    expect(a.match_points).toBe(1);
    expect(a.match_draws).toBe(1);
    expect(a.game_wins).toBe(0);
    expect(a.game_losses).toBe(0);
    // Three drawn games: GW% = 3 / (3 × 3) = 0.3333
    expect(a.gw_percent).toBe(0.3333);
    expect(b.match_points).toBe(1);
  });

  // The MTR does not cover double losses. Match loss = 0 points (MTR App. C);
  // WER recorded a double match loss as 0-2 for each player (Magic Judges
  // forum, 2019: apps.magicjudges.org/forum/post/276445, /post/279562).
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
    // B: 0 match points in 1 round → MWP = max(0.33, 0) = 0.33
    // C: 0 match points in 1 round → MWP = max(0.33, 0) = 0.33
    expect(a.omw_percent).toBe(0.33);
  });

  // ── GW% floor ────────────────────────────────────────────────────────────

  it('applies GW% floor for a player with 0 games played', () => {
    // C has a result-less pairing only (no outcome entered yet).
    const records: MatchRecord[] = [{ ...win(1, 'C', 'D'), outcome: null }];
    const entries = computeStandings(['C', 'D'], records, 1);
    expect(byId(entries, 'C').gw_percent).toBe(0.33);
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
  // B played only round 1 (lost 1-2 to A), then left. MTR Appendix C: OGW%
  // is the mean of the opponents' GW% — for B, just A's: A won 4 of 5 games.
  it("is that one opponent's GW%", () => {
    const records = [win(1, 'A', 'B', '2-1'), win(2, 'A', 'C')];
    const b = computeStandings(['A', 'B', 'C'], records, 2).find((s) => s.player_id === 'B')!;
    expect(b.ogw_percent).toBe(0.8);
  });
});

// ── Tiebreaker order (MTR §3.1, Appendix C) ──────────────────────────────────
// Order: match points, then OMW%, then GW%, then OGW%, all descending.
// Expected values were computed independently from the MTR Appendix C
// formulas (match points / 3·rounds, game points / 3·games, 0.33 floor per
// opponent), not by this engine. Draws and byes are covered in
// standings.engine.mtr.test.ts.
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
