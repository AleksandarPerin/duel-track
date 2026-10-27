export type Outcome =
  | 'player1_win'
  | 'player2_win'
  | 'draw'
  | 'intentional_draw'
  | 'double_loss';

export interface MatchRecord {
  round_number: number;
  player1_id: string;
  player2_id: string | null;
  is_bye: boolean;
  player1_game_wins: number;
  player2_game_wins: number;
  games_drawn: number;
  outcome: Outcome | null;
}

export interface StandingEntry {
  player_id: string;
  match_points: number;
  match_wins: number;
  match_losses: number;
  match_draws: number;
  game_wins: number;
  game_losses: number;
  omw_percent: number;
  gw_percent: number;
  ogw_percent: number;
  rank: number;
}

// Tiebreakers are kept as exact fractions and compared exactly; only the
// stored and displayed values are rounded to 4 dp. Rounding first would tie
// players whose values differ in the 5th decimal, and comparing floats would
// split exact ties (e.g. two OMW% of 287/600 summed in a different order).
interface Fraction { n: bigint; d: bigint } // d > 0, lowest terms

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a;
}
function frac(n: number | bigint, d: number | bigint): Fraction {
  const N = BigInt(n), D = BigInt(d), g = gcd(N, D) || 1n;
  return { n: N / g, d: D / g };
}
function add(a: Fraction, b: Fraction): Fraction { return frac(a.n * b.d + b.n * a.d, a.d * b.d); }
function cmp(a: Fraction, b: Fraction): number {
  const x = a.n * b.d - b.n * a.d;
  return x > 0n ? 1 : x < 0n ? -1 : 0;
}
function atLeastFloor(f: Fraction): Fraction { return cmp(f, FLOOR) < 0 ? FLOOR : f; }
function mean(values: Fraction[]): Fraction {
  if (values.length === 0) return FLOOR;
  const sum = values.reduce(add, frac(0, 1));
  return frac(sum.n, sum.d * BigInt(values.length));
}
// Rounded half up to 4 dp (all values here are non-negative).
function round4(f: Fraction): number {
  return Number((f.n * 20000n + f.d) / (2n * f.d)) / 10000;
}

const FLOOR = frac(33, 100);

interface Totals {
  match_points: number;
  match_wins: number;
  match_losses: number;
  match_draws: number;
  game_wins: number;
  game_losses: number;
  game_points: number;   // 3 per game won, 1 per drawn game
  games_played: number;  // won + lost + drawn games
  rounds_played: number; // bye rounds included
}

function zero(): Totals {
  return {
    match_points: 0, match_wins: 0, match_losses: 0, match_draws: 0,
    game_wins: 0, game_losses: 0, game_points: 0, games_played: 0,
    rounds_played: 0,
  };
}

// Pure MTR Appendix C standings computation (MTR 2026-02-27; PRD v1.2 and
// earlier counted draws as 0 and left byes out of MWP).
//
//   MWP = match points / (3 × rounds played)   — a draw is 1 point, a bye 3
//   GWP = game points / (3 × games played)     — a drawn game is 1 point
//
// A bye is a 2-0 win in the receiver's own MWP and GWP, as everyone sees them,
// but is not an opponent: it is absent from the receiver's opponent list.
// An intentional draw with no games recorded counts as one drawn game, 0-0-1:
// the MTR is ambiguous (§2.5 "reported as 0-0-3" vs App. C "unplayed games
// are worth 0 points"); product decision 2026-10-27 — reportedly what WER
// recorded for IDs.
//
// Key invariant: the 0.33 floor is applied to each opponent's MWP/GWP
// individually before averaging — NOT to the final average.
//
// throughRound lets callers compute historical standings without filtering records.
export function computeStandings(
  playerIds: readonly string[],
  records: readonly MatchRecord[],
  throughRound: number,
): StandingEntry[] {
  if (playerIds.length === 0) return [];

  const totals = new Map<string, Totals>(playerIds.map((id) => [id, zero()]));
  const opponents = new Map<string, string[]>(playerIds.map((id) => [id, []]));

  for (const r of records) {
    if (r.round_number > throughRound) continue;

    if (r.is_bye) {
      const t = totals.get(r.player1_id);
      if (t) {
        t.match_points += 3;
        t.match_wins += 1;
        t.rounds_played += 1;
        t.game_wins += 2;
        t.game_points += 6;
        t.games_played += 2;
        // Not added to the opponent list (MTR App. C, Byes)
      }
      continue;
    }

    if (!r.outcome || !r.player2_id) continue;
    const t1 = totals.get(r.player1_id);
    const t2 = totals.get(r.player2_id);
    if (!t1 || !t2) continue;

    opponents.get(r.player1_id)!.push(r.player2_id);
    opponents.get(r.player2_id)!.push(r.player1_id);
    t1.rounds_played += 1;
    t2.rounds_played += 1;

    if (r.outcome === 'double_loss') {
      // Stored game counts are 0-0-0; recorded as 0-2 for each player, as WER did
      t1.match_losses += 1;
      t2.match_losses += 1;
      t1.game_losses += 2; t1.games_played += 2;
      t2.game_losses += 2; t2.games_played += 2;
      continue;
    }

    // For all other outcomes, game stats derive from the stored columns,
    // except an intentional draw stored 0-0-0, which counts as 0-0-1.
    const gTotal = r.player1_game_wins + r.player2_game_wins + r.games_drawn;
    const drawn = r.outcome === 'intentional_draw' && gTotal === 0 ? 1 : r.games_drawn;
    const played = r.player1_game_wins + r.player2_game_wins + drawn;
    t1.game_wins += r.player1_game_wins; t1.game_losses += r.player2_game_wins; t1.games_played += played;
    t2.game_wins += r.player2_game_wins; t2.game_losses += r.player1_game_wins; t2.games_played += played;
    t1.game_points += 3 * r.player1_game_wins + drawn;
    t2.game_points += 3 * r.player2_game_wins + drawn;

    switch (r.outcome) {
      case 'player1_win':
        t1.match_points += 3; t1.match_wins += 1;
        t2.match_losses += 1;
        break;
      case 'player2_win':
        t2.match_points += 3; t2.match_wins += 1;
        t1.match_losses += 1;
        break;
      case 'draw':
      case 'intentional_draw':
        t1.match_points += 1; t1.match_draws += 1;
        t2.match_points += 1; t2.match_draws += 1;
        break;
    }
  }

  // GW% per player (floor at 0.33; 0 games played → floor)
  const gw = new Map<string, Fraction>(
    [...totals.entries()].map(([id, t]) => [
      id,
      t.games_played === 0 ? FLOOR : atLeastFloor(frac(t.game_points, 3 * t.games_played)),
    ]),
  );
  // MWP per player, floored; every opponent has played at least one round
  const mwp = (t: Totals) => atLeastFloor(frac(t.match_points, 3 * Math.max(1, t.rounds_played)));

  // OMW% / OGW%: mean of the opponents' individually floored MWP / GW%
  const keys = new Map(playerIds.map((id) => {
    const opp = opponents.get(id)!;
    return [id, {
      omw: mean(opp.map((oid) => mwp(totals.get(oid)!))),
      gw: gw.get(id)!,
      ogw: mean(opp.map((oid) => gw.get(oid)!)),
    }];
  }));

  const entries: StandingEntry[] = playerIds.map((id) => {
    const t = totals.get(id)!;
    const k = keys.get(id)!;
    return {
      player_id: id,
      match_points: t.match_points,
      match_wins: t.match_wins,
      match_losses: t.match_losses,
      match_draws: t.match_draws,
      game_wins: t.game_wins,
      game_losses: t.game_losses,
      omw_percent: round4(k.omw),
      gw_percent: round4(k.gw),
      ogw_percent: round4(k.ogw),
      rank: 0,
    };
  });

  // Sort: match_points DESC, then exact OMW%, GW%, OGW% DESC. Array.sort is
  // stable, so players tied on everything keep their playerIds order.
  entries.sort((a, b) => {
    if (a.match_points !== b.match_points) return b.match_points - a.match_points;
    const ka = keys.get(a.player_id)!, kb = keys.get(b.player_id)!;
    return cmp(kb.omw, ka.omw) || cmp(kb.gw, ka.gw) || cmp(kb.ogw, ka.ogw);
  });

  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}
