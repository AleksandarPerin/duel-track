import { describe, it, expect } from 'vitest';
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

  it('handles prior match given in reverse order', () => {
    const ps = [
      player('A', { sort_seed: 1 }),
      player('B', { sort_seed: 2 }),
      player('C', { sort_seed: 3 }),
      player('D', { sort_seed: 4 }),
    ];
    // Prior stored with reversed player order — should still count as a rematch
    const r = generatePairings(ps, [prior('B', 'A')]);
    const pairs = r.matches.map((m) => [m.player1_id, m.player2_id].sort().join('-'));
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
    const r2 = generatePairings(ps, [prior('p1', 'p2')]);
    // At least the pairing of p1-p2 should be suppressed in r2
    const pairs2 = r2.matches.map((m) => [m.player1_id, m.player2_id].sort().join('-'));
    expect(pairs2).not.toContain('p1-p2');
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
