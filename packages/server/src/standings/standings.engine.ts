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

const FLOOR = 0.33;

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
// An intentional draw with no games recorded is 0-0-3 (MTR §2.5).
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
    // except an intentional draw stored 0-0-0, which counts as 0-0-3.
    const gTotal = r.player1_game_wins + r.player2_game_wins + r.games_drawn;
    const drawn = r.outcome === 'intentional_draw' && gTotal === 0 ? 3 : r.games_drawn;
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
  const gw = new Map<string, number>(
    [...totals.entries()].map(([id, t]) => [
      id,
      t.games_played === 0 ? FLOOR : Math.max(FLOOR, t.game_points / (3 * t.games_played)),
    ]),
  );

  // OMW% per player: mean of per-opponent MWP, each individually floored at 0.33
  const omw = new Map<string, number>(
    [...opponents.entries()].map(([id, opp]) => {
      if (opp.length === 0) return [id, FLOOR];
      let sum = 0;
      for (const oid of opp) {
        const ot = totals.get(oid)!;
        sum += ot.rounds_played === 0
          ? FLOOR
          : Math.max(FLOOR, ot.match_points / (3 * ot.rounds_played));
      }
      return [id, sum / opp.length];
    }),
  );

  // OGW% per player: mean of opponents' GW% (already floored individually)
  const ogw = new Map<string, number>(
    [...opponents.entries()].map(([id, opp]) => {
      if (opp.length === 0) return [id, FLOOR];
      let sum = 0;
      for (const oid of opp) sum += gw.get(oid)!;
      return [id, sum / opp.length];
    }),
  );

  const r4 = (n: number) => Math.round(n * 10000) / 10000;

  const entries: StandingEntry[] = playerIds.map((id) => {
    const t = totals.get(id)!;
    return {
      player_id: id,
      match_points: t.match_points,
      match_wins: t.match_wins,
      match_losses: t.match_losses,
      match_draws: t.match_draws,
      game_wins: t.game_wins,
      game_losses: t.game_losses,
      omw_percent: r4(omw.get(id) ?? FLOOR),
      gw_percent: r4(gw.get(id) ?? FLOOR),
      ogw_percent: r4(ogw.get(id) ?? FLOOR),
      rank: 0,
    };
  });

  // Sort: match_points DESC, omw_percent DESC, gw_percent DESC, ogw_percent DESC
  entries.sort((a, b) => {
    if (a.match_points !== b.match_points) return b.match_points - a.match_points;
    if (a.omw_percent !== b.omw_percent) return b.omw_percent - a.omw_percent;
    if (a.gw_percent !== b.gw_percent) return b.gw_percent - a.gw_percent;
    return b.ogw_percent - a.ogw_percent;
  });

  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}
