import type { HeadToHeadOpponentView } from '@dueltrack/shared';
import type { Outcome } from '../standings/standings.engine';

export interface HeadToHeadMatchRow {
  pairing_id: string;
  outcome: Outcome;
  my_side: 'player1' | 'player2';
  opponent_tp_id: string;
  opponent_user_id: string | null;
  opponent_guest_name: string | null;
  opponent_account_name: string | null;
}

export type MatchResult = 'win' | 'loss' | 'draw';

// Mirrors the outcome switch in standings.engine.ts computeStandings, from
// one side's perspective instead of aggregating both sides at once.
export function outcomeForSide(outcome: Outcome, mySide: 'player1' | 'player2'): MatchResult {
  switch (outcome) {
    case 'draw':
    case 'intentional_draw':
      return 'draw';
    case 'double_loss':
      return 'loss';
    case 'player1_win':
      return mySide === 'player1' ? 'win' : 'loss';
    case 'player2_win':
      return mySide === 'player2' ? 'win' : 'loss';
  }
}

const TOP_N = 10;

// Grouping key: a linked opponent (opponent_user_id present) is the same
// person across every tournament they've played, so group by user_id. An
// unlinked guest opponent cannot be reliably merged across different events
// (two different people can share a guest_name), so group by the literal
// tournament_players.id instead — this only merges rows within the same
// event (e.g. a Swiss rematch), never across events.
export function buildHeadToHead(rows: readonly HeadToHeadMatchRow[]): HeadToHeadOpponentView[] {
  const groups = new Map<string, {
    opponent_user_id: string | null;
    opponent_display_name: string;
    wins: number;
    losses: number;
    draws: number;
    matches_played: number;
  }>();

  for (const row of rows) {
    const key = row.opponent_user_id ? `user:${row.opponent_user_id}` : `tp:${row.opponent_tp_id}`;
    // account display_name / guest_name are each NOT NULL in exactly the
    // complementary case (schema-guaranteed); the fallback only exists to
    // satisfy the type checker.
    const displayName = row.opponent_account_name ?? row.opponent_guest_name ?? 'Unknown Player';

    let group = groups.get(key);
    if (!group) {
      group = { opponent_user_id: row.opponent_user_id, opponent_display_name: displayName,
        wins: 0, losses: 0, draws: 0, matches_played: 0 };
      groups.set(key, group);
    }
    group.opponent_display_name = displayName;
    group.matches_played += 1;

    const result = outcomeForSide(row.outcome, row.my_side);
    if (result === 'win') group.wins += 1;
    else if (result === 'loss') group.losses += 1;
    else group.draws += 1;
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.matches_played !== b.matches_played) return b.matches_played - a.matches_played;
      if (a.wins !== b.wins) return b.wins - a.wins;
      return a.opponent_display_name.localeCompare(b.opponent_display_name);
    })
    .slice(0, TOP_N);
}
