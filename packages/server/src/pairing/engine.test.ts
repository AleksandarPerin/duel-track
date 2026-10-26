import { afterEach, describe, it, expect, vi } from 'vitest';
import { generatePairings, assignTables } from './engine';
import type { PlayerRecord, PriorMatch } from './types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function player(
  id: string,
  opts: Partial<Omit<PlayerRecord, 'id'>> = {},
): PlayerRecord {
  return {
    id,
    sort_seed: opts.sort_seed ?? 1,
    byes_received: opts.byes_received ?? 0,
    match_points: opts.match_points ?? 0,
    omw_pct: opts.omw_pct ?? 0,
    gw_pct: opts.gw_pct ?? 0,
  };
}

function players(count: number, matchPoints = 0): PlayerRecord[] {
  return Array.from({ length: count }, (_, i) =>
    player(`p${i + 1}`, { sort_seed: i + 1, match_points: matchPoints }),
  );
}

function prior(a: string, b: string): PriorMatch {
  return { player1_id: a, player2_id: b };
}

// ── generatePairings ────────────────────────────────────────────────────────

describe('generatePairings', () => {
  it('returns empty result for empty player list', () => {
    const r = generatePairings([], []);
    expect(r.matches).toHaveLength(0);
    expect(r.bye_player_id).toBeNull();
    expect(r.warning).toBeUndefined();
  });

  it('returns single bye for a single player', () => {
    const r = generatePairings([player('p1')], []);
    expect(r.matches).toHaveLength(0);
    expect(r.bye_player_id).toBe('p1');
  });

  it('pairs two players', () => {
    const r = generatePairings([player('p1', { sort_seed: 1 }), player('p2', { sort_seed: 2 })], []);
    expect(r.matches).toHaveLength(1);
    expect(r.bye_player_id).toBeNull();
    const ids = [r.matches[0]!.player1_id, r.matches[0]!.player2_id].sort();
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('produces n/2 matches for n even players', () => {
    const r = generatePairings(players(8), []);
    expect(r.matches).toHaveLength(4);
    expect(r.bye_player_id).toBeNull();
  });

  it('assigns exactly one bye for odd player count', () => {
    const r = generatePairings(players(9), []);
    expect(r.matches).toHaveLength(4);
    expect(r.bye_player_id).not.toBeNull();
  });

  it('every player appears in exactly one match or as bye', () => {
    const ps = players(11);
    const r = generatePairings(ps, []);
    const allIds = new Set<string>();
    for (const m of r.matches) {
      allIds.add(m.player1_id);
      allIds.add(m.player2_id);
    }
    if (r.bye_player_id) allIds.add(r.bye_player_id);
    expect(allIds.size).toBe(ps.length);
    for (const p of ps) expect(allIds.has(p.id)).toBe(true);
  });

  // ── Bye candidate selection ────────────────────────────────────────────────

  it('selects bye by fewest byes_received', () => {
    const ps = [
      player('a', { sort_seed: 1, byes_received: 1, match_points: 0 }),
      player('b', { sort_seed: 2, byes_received: 0, match_points: 0 }),
      player('c', { sort_seed: 3, byes_received: 0, match_points: 0 }),
    ];
    // b and c both have 0 byes; a has 1 → a should NOT get the bye
    const r = generatePairings(ps, []);
    expect(r.bye_player_id).not.toBe('a');
  });

  it('breaks bye tie by lowest match_points', () => {
    const ps = [
      player('a', { sort_seed: 1, byes_received: 0, match_points: 6 }),
      player('b', { sort_seed: 2, byes_received: 0, match_points: 3 }),
      player('c', { sort_seed: 3, byes_received: 0, match_points: 3 }),
    ];
    // b and c tied at 3 pts; a has 6 → a should NOT get the bye
    const r = generatePairings(ps, []);
    expect(r.bye_player_id).not.toBe('a');
  });

  it('breaks bye tie by lowest omw_pct', () => {
    const ps = [
      player('a', { sort_seed: 1, byes_received: 0, match_points: 0, omw_pct: 0.5 }),
      player('b', { sort_seed: 2, byes_received: 0, match_points: 0, omw_pct: 0.33 }),
      player('c', { sort_seed: 3, byes_received: 0, match_points: 0, omw_pct: 0.33 }),
    ];
    const r = generatePairings(ps, []);
    expect(r.bye_player_id).not.toBe('a');
  });

  it('breaks bye tie by lowest sort_seed', () => {
    const ps = [
      player('a', { sort_seed: 1, byes_received: 0, match_points: 0, omw_pct: 0.33 }),
      player('b', { sort_seed: 2, byes_received: 0, match_points: 0, omw_pct: 0.33 }),
      player('c', { sort_seed: 3, byes_received: 0, match_points: 0, omw_pct: 0.33 }),
    ];
    const r = generatePairings(ps, []);
    expect(r.bye_player_id).toBe('a'); // lowest sort_seed wins bye
  });

  // ── Rematch avoidance ──────────────────────────────────────────────────────

  it('avoids rematching when alternative exists', () => {
    // Players A,B,C,D; A vs B already played. Should pair A-C + B-D (or A-D + B-C).
    const ps = [
      player('A', { sort_seed: 1 }),
      player('B', { sort_seed: 2 }),
      player('C', { sort_seed: 3 }),
      player('D', { sort_seed: 4 }),
    ];
    const r = generatePairings(ps, [prior('A', 'B')]);
    const pairs = r.matches.map((m) => [m.player1_id, m.player2_id].sort().join('-'));
    expect(pairs).not.toContain('A-B');
  });

  it('permits rematch when no alternative exists', () => {
    // With 2 players who always played each other, they must rematch
    const ps = [player('X', { sort_seed: 1 }), player('Y', { sort_seed: 2 })];
    const r = generatePairings(ps, [prior('X', 'Y')]);
    expect(r.matches).toHaveLength(1);
    const ids = [r.matches[0]!.player1_id, r.matches[0]!.player2_id].sort();
    expect(ids).toEqual(['X', 'Y']);
  });

  // A and B lead the 6-point bracket, C and D the 3-point one: without a
  // prior match the engine pairs A-B (see 'prefers same-bracket pairings'
  // below), so these only pass if the prior match actually changes that.
  // Swiss definition: no player meets the same opponent twice when a
  // pairing without rematches exists — even at the cost of pairing across
  // brackets (A-C + B-D here).
  const twoBrackets = () => [
    player('A', { sort_seed: 1, match_points: 6 }),
    player('B', { sort_seed: 2, match_points: 6 }),
    player('C', { sort_seed: 3, match_points: 3 }),
    player('D', { sort_seed: 4, match_points: 3 }),
  ];
  const pairsOf = (r: { matches: { player1_id: string; player2_id: string }[] }) =>
    r.matches.map((m) => [m.player1_id, m.player2_id].sort().join('-')).sort();
  // A-C + B-D and A-D + B-C cost the same; the seed hash picks between
  // them, so either is a correct rematch-free answer.
  const CROSS_BRACKET = [['A-C', 'B-D'], ['A-D', 'B-C']];

  it('pairs across brackets rather than allow a rematch', () => {
    expect(pairsOf(generatePairings(twoBrackets(), []))).toEqual(['A-B', 'C-D']);
    const r = generatePairings(twoBrackets(), [prior('A', 'B')]);
    expect(CROSS_BRACKET).toContainEqual(pairsOf(r));
  });

  it('handles prior match given in reverse order', () => {
    // Prior stored with reversed player order — still a rematch.
    const r = generatePairings(twoBrackets(), [prior('B', 'A')]);
    expect(CROSS_BRACKET).toContainEqual(pairsOf(r));
  });

  it('avoids a rematch even when that costs several bracket crossings', () => {
    // A, B on 9 points have played; brackets are numbered by the point
    // totals present (9, 6, 3, 0), so X and Y fill the gap. The best
    // rematch-free pairing crosses 3 bracket steps; the rematch would cross
    // one — still not chosen.
    const ps = [
      player('A', { sort_seed: 1, match_points: 9 }),
      player('B', { sort_seed: 2, match_points: 9 }),
      player('X', { sort_seed: 5, match_points: 6 }),
      player('Y', { sort_seed: 6, match_points: 3 }),
      player('C', { sort_seed: 3, match_points: 0 }),
      player('D', { sort_seed: 4, match_points: 0 }),
    ];
    const pairs = pairsOf(generatePairings(ps, [prior('A', 'B')]));
    expect(pairs).not.toContain('A-B');
  });

  it('keeps avoiding the rematch when every nearby opponent is also a rematch', () => {
    // A and B (9 points) have played each other and both 6-point players,
    // so a rematch-free pairing must reach two brackets down (cost 2 × 60).
    // Only a rematch penalty far above bracket costs still avoids A-B here.
    const ps = [
      player('A', { sort_seed: 1, match_points: 9 }),
      player('B', { sort_seed: 2, match_points: 9 }),
      player('X1', { sort_seed: 3, match_points: 6 }),
      player('X2', { sort_seed: 4, match_points: 6 }),
      player('Y1', { sort_seed: 5, match_points: 3 }),
      player('Y2', { sort_seed: 6, match_points: 3 }),
    ];
    const priors = [prior('A', 'B'), prior('A', 'X1'), prior('A', 'X2'), prior('B', 'X1'), prior('B', 'X2')];
    const pairs = pairsOf(generatePairings(ps, priors));
    expect(pairs).toContain('X1-X2');
    expect(pairs).not.toContain('A-B');
  });

  // ── Bracket preference ─────────────────────────────────────────────────────

  it('prefers same-bracket pairings over cross-bracket', () => {
    // A,B have 6 pts; C,D have 3 pts. Optimal: A-B + C-D (same bracket).
    const ps = [
      player('A', { sort_seed: 1, match_points: 6 }),
      player('B', { sort_seed: 2, match_points: 6 }),
      player('C', { sort_seed: 3, match_points: 3 }),
      player('D', { sort_seed: 4, match_points: 3 }),
    ];
    const r = generatePairings(ps, []);
    const pairs = r.matches.map((m) => [m.player1_id, m.player2_id].sort().join('-'));
    expect(pairs).toContain('A-B');
    expect(pairs).toContain('C-D');
  });

  it('allows cross-bracket when necessary (odd bracket size)', () => {
    // A,B,C have 6 pts (odd bracket); D,E have 3 pts. One player must cross.
    const ps = [
      player('A', { sort_seed: 1, match_points: 6 }),
      player('B', { sort_seed: 2, match_points: 6 }),
      player('C', { sort_seed: 3, match_points: 6 }),
      player('D', { sort_seed: 4, match_points: 3 }),
      player('E', { sort_seed: 5, match_points: 3 }),
    ];
    const r = generatePairings(ps, []);
    // All 5 players must appear (2 matches + 1 bye or all 5 matched somehow)
    // Odd total → 2 matches + 1 bye
    const allIds = new Set<string>(
      r.matches.flatMap((m) => [m.player1_id, m.player2_id]),
    );
    if (r.bye_player_id) allIds.add(r.bye_player_id);
    expect(allIds.size).toBe(5);
  });

  // ── Determinism ────────────────────────────────────────────────────────────

  it('produces identical output on repeated calls with same input', () => {
    const ps = players(8);
    const priors = [prior('p1', 'p2'), prior('p3', 'p4')];
    const r1 = generatePairings(ps, priors);
    const r2 = generatePairings(ps, priors);
    expect(r1.matches).toEqual(r2.matches);
    expect(r1.bye_player_id).toBe(r2.bye_player_id);
  });

  it('produces different output when inputs differ', () => {
    const ps = players(4);
    const r1 = generatePairings(ps, []);
    // Whatever r1 paired first, making it a prior match must break it up.
    const first = r1.matches[0]!;
    const r2 = generatePairings(ps, [prior(first.player1_id, first.player2_id)]);
    const key = [first.player1_id, first.player2_id].sort().join('-');
    expect(pairsOf(r1)).toContain(key);
    expect(pairsOf(r2)).not.toContain(key);
  });

  // ── Scale ──────────────────────────────────────────────────────────────────

  it('handles 512 players within 3 seconds', () => {
    const ps = players(512);
    const t0 = Date.now();
    const r = generatePairings(ps, []);
    const elapsed = Date.now() - t0;
    expect(r.matches).toHaveLength(256);
    expect(r.bye_player_id).toBeNull();
    expect(elapsed).toBeLessThan(3_000);
  }, 10_000);

  it('handles 511 players (odd) within 3 seconds', () => {
    const ps = players(511);
    const t0 = Date.now();
    const r = generatePairings(ps, []);
    const elapsed = Date.now() - t0;
    expect(r.matches).toHaveLength(255);
    expect(r.bye_player_id).not.toBeNull();
    expect(elapsed).toBeLessThan(3_000);
  }, 10_000);

  // ── Bye priority between keys ──────────────────────────────────────────────

  it('gives the bye to the player with fewer byes even if they have more points', () => {
    // byes_received outranks match points: a second bye is avoided first.
    const ps = [
      player('P', { sort_seed: 1, byes_received: 1, match_points: 0 }),
      player('Q', { sort_seed: 2, byes_received: 0, match_points: 3 }),
      player('R', { sort_seed: 3, byes_received: 1, match_points: 3 }),
    ];
    expect(generatePairings(ps, []).bye_player_id).toBe('Q');
  });

  it('breaks a points tie by lower OMW, before sort_seed', () => {
    const ps = [
      player('P', { sort_seed: 1, match_points: 3, omw_pct: 0.5 }),
      player('Q', { sort_seed: 2, match_points: 3, omw_pct: 0.4 }),
      player('R', { sort_seed: 3, match_points: 6, omw_pct: 0.3 }),
    ];
    expect(generatePairings(ps, []).bye_player_id).toBe('Q');
  });

  // ── Slow-pairing warning ───────────────────────────────────────────────────

  describe('slow-pairing warning', () => {
    afterEach(() => vi.restoreAllMocks());
    const timed = (ms: number) => {
      vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_000 + ms);
      return generatePairings(players(4), []);
    };

    it('warns when blossom takes longer than 2.5 s', () => {
      expect(timed(2_501).warning).toMatch(/took 2501ms/);
    });

    it('stays quiet at exactly 2.5 s', () => {
      expect(timed(2_500).warning).toBeUndefined();
    });
  });
});

// ── assignTables ─────────────────────────────────────────────────────────────

describe('assignTables', () => {
  it('returns empty array for empty matches', () => {
    expect(assignTables([], [])).toHaveLength(0);
  });

  it('assigns table 1 to the highest combined match-points pairing', () => {
    const ps = [
      player('A', { match_points: 9 }),
      player('B', { match_points: 9 }),
      player('C', { match_points: 3 }),
      player('D', { match_points: 3 }),
    ];
    const matches = [
      { player1_id: 'C', player2_id: 'D' },
      { player1_id: 'A', player2_id: 'B' },
    ];
    const tables = assignTables(matches, ps);
    expect(tables[0]!.table_number).toBe(1);
    expect([tables[0]!.player1_id, tables[0]!.player2_id].sort()).toEqual(['A', 'B']);
  });

  it('assigns sequential table numbers', () => {
    const ps = players(6, 0);
    const result = generatePairings(ps, []);
    const tables = assignTables(result.matches, ps);
    const nums = tables.map((t) => t.table_number).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3]);
  });

  it('does not mutate the original matches array', () => {
    const ps = [player('A', { match_points: 3 }), player('B', { match_points: 3 })];
    const matches = [{ player1_id: 'A', player2_id: 'B' }];
    const copy = [...matches];
    assignTables(matches, ps);
    expect(matches).toEqual(copy);
  });
});
