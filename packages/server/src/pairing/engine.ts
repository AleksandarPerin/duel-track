import blossom from 'edmonds-blossom';
import type { PlayerRecord, PriorMatch, PairingResult, Match } from './types';

const BASE_WEIGHT = 10_000;
const REMATCH_PENALTY = 5_000;
const BRACKET_CROSS_PENALTY = 30;

// Deterministic float in [0, 1) derived from two sort_seed values (PRD §6.2).
// Must stay below 1 so it never overrides BRACKET_CROSS_PENALTY (≥1) or REMATCH_PENALTY.
function jitter(s1: number, s2: number): number {
  let h = (s1 ^ s2) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Pure, deterministic Swiss pairing engine.
// Given the same inputs it always produces the same output — required for auditability.
export function generatePairings(
  activePlayers: PlayerRecord[],
  priorMatches: PriorMatch[],
): PairingResult {
  if (activePlayers.length === 0) {
    return { matches: [], bye_player_id: null };
  }

  const rematches = new Set<string>(
    priorMatches.map((m) => pairKey(m.player1_id, m.player2_id)),
  );

  // Bye candidate: fewest byes_received; ties broken by match_points ASC, omw_pct ASC, sort_seed ASC.
  // The lowest-ranked active player (weakest record) receives the bye.
  let byePlayerId: string | null = null;
  let pool = [...activePlayers];

  if (pool.length % 2 !== 0) {
    const byeCandidate = [...pool].sort((a, b) => {
      if (a.byes_received !== b.byes_received) return a.byes_received - b.byes_received;
      if (a.match_points !== b.match_points) return a.match_points - b.match_points;
      if (a.omw_pct !== b.omw_pct) return a.omw_pct - b.omw_pct;
      return a.sort_seed - b.sort_seed;
    })[0]!;
    byePlayerId = byeCandidate.id;
    pool = pool.filter((p) => p.id !== byePlayerId);
  }

  const n = pool.length;
  if (n === 0) {
    return { matches: [], bye_player_id: byePlayerId };
  }

  // Bracket index: 0 = top bracket (most points). Used to penalise cross-bracket pairings.
  const uniquePoints = [...new Set(pool.map((p) => p.match_points))].sort((a, b) => b - a);
  const bracketOf = new Map<number, number>(uniquePoints.map((pts, idx) => [pts, idx]));

  // Build weighted edge list: higher weight → better pairing.
  // Minimum possible weight = BASE − REMATCH − BRACKET_CROSS × max_brackets + jitter_min
  // = 10000 − 5000 − 30×10 + 0 = 4700 > 0, so blossom always returns a perfect matching.
  // jitter ∈ [0, 1) is intentionally < BRACKET_CROSS_PENALTY so it never overrides bracket logic.
  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pi = pool[i]!;
      const pj = pool[j]!;
      const dist = Math.abs(bracketOf.get(pi.match_points)! - bracketOf.get(pj.match_points)!);
      const rematch = rematches.has(pairKey(pi.id, pj.id));
      const weight =
        BASE_WEIGHT
        - (rematch ? REMATCH_PENALTY : 0)
        - BRACKET_CROSS_PENALTY * dist
        + jitter(pi.sort_seed, pj.sort_seed);
      edges.push([i, j, weight]);
    }
  }

  const t0 = Date.now();
  const matching = blossom(edges);
  const elapsed = Date.now() - t0;

  let warning: string | undefined;
  if (elapsed > 2_500) {
    warning = `Pairing engine took ${elapsed}ms; SLA is 3000ms — blossom may be under stress`;
  }

  // Extract pairs: matching[i]=j AND matching[j]=i; iterate once to avoid duplicates.
  const seen = new Set<number>();
  const matches: Match[] = [];
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    const j = matching[i] ?? -1;
    if (j === -1) continue;
    seen.add(i);
    seen.add(j);
    matches.push({ player1_id: pool[i]!.id, player2_id: pool[j]!.id });
  }

  // Defensive: blossom should never leave players unmatched with positive weights,
  // but greedily pair any stragglers rather than silently dropping them.
  const unmatched = pool.filter((_, i) => !seen.has(i));
  if (unmatched.length >= 2) {
    for (let i = 0; i + 1 < unmatched.length; i += 2) {
      matches.push({ player1_id: unmatched[i]!.id, player2_id: unmatched[i + 1]!.id });
    }
    warning = (warning ?? '') + ' Blossom returned incomplete matching; greedy fallback applied.';
  }

  return { matches, bye_player_id: byePlayerId, warning };
}

// Assigns table numbers to matches: table 1 = highest combined match-point pairing.
export function assignTables(
  matches: Match[],
  players: PlayerRecord[],
): Array<Match & { table_number: number }> {
  const pointsOf = new Map(players.map((p) => [p.id, p.match_points]));
  return [...matches]
    .sort((a, b) => {
      const ta = (pointsOf.get(a.player1_id) ?? 0) + (pointsOf.get(a.player2_id) ?? 0);
      const tb = (pointsOf.get(b.player1_id) ?? 0) + (pointsOf.get(b.player2_id) ?? 0);
      return tb - ta;
    })
    .map((m, idx) => ({ ...m, table_number: idx + 1 }));
}
