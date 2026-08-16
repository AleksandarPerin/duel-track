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
  games_played: number;
  non_bye_wins: number;   // match wins from actual matches; used for opponent MWP
  non_bye_played: number; // actual matches played (bye rounds excluded)
}

function zero(): Totals {
  return {
    match_points: 0, match_wins: 0, match_losses: 0, match_draws: 0,
    game_wins: 0, game_losses: 0, games_played: 0,
    non_bye_wins: 0, non_bye_played: 0,
  };
}

// Pure MTR Appendix E standings computation.
//
// Key invariant: OMW% floor (0.33) is applied to each opponent's MWP individually
// before averaging — NOT to the final average. Applying the floor to the average
// is the common implementation mistake described in PRD §5.4.
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
        t.game_wins += 2;
        t.games_played += 2;
        // Bye excluded from non_bye_* and opponent list (PRD §5.4)
      }
      continue;
    }

    if (!r.outcome || !r.player2_id) continue;
    const t1 = totals.get(r.player1_id);
    const t2 = totals.get(r.player2_id);
    if (!t1 || !t2) continue;

    opponents.get(r.player1_id)!.push(r.player2_id);
    opponents.get(r.player2_id)!.push(r.player1_id);
    t1.non_bye_played += 1;
    t2.non_bye_played += 1;

    if (r.outcome === 'double_loss') {
      // Stored game counts are 0-0-0; app credits 2 game losses / 2 games played each (PRD §6.3 comment)
      t1.match_losses += 1;
      t2.match_losses += 1;
      t1.game_losses += 2; t1.games_played += 2;
      t2.game_losses += 2; t2.games_played += 2;
      continue;
    }

    // For all other outcomes, game stats derive directly from stored columns.
    // draw (1-1-1): gTotal = 1+1+1 = 3; intentional_draw: gTotal = 0+0+0 = 0.
    const gTotal = r.player1_game_wins + r.player2_game_wins + r.games_drawn;
    t1.game_wins += r.player1_game_wins; t1.game_losses += r.player2_game_wins; t1.games_played += gTotal;
    t2.game_wins += r.player2_game_wins; t2.game_losses += r.player1_game_wins; t2.games_played += gTotal;

    switch (r.outcome) {
      case 'player1_win':
        t1.match_points += 3; t1.match_wins += 1; t1.non_bye_wins += 1;
        t2.match_losses += 1;
        break;
      case 'player2_win':
        t2.match_points += 3; t2.match_wins += 1; t2.non_bye_wins += 1;
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
      t.games_played === 0 ? FLOOR : Math.max(FLOOR, t.game_wins / t.games_played),
    ]),
  );

  // OMW% per player: mean of per-opponent MWP, each individually floored at 0.33
  const omw = new Map<string, number>(
    [...opponents.entries()].map(([id, opp]) => {
      if (opp.length === 0) return [id, FLOOR];
      let sum = 0;
      for (const oid of opp) {
        const ot = totals.get(oid)!;
        sum += ot.non_bye_played === 0
          ? FLOOR
          : Math.max(FLOOR, ot.non_bye_wins / ot.non_bye_played);
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
