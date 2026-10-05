import { describe, expect, it } from 'vitest';
import type { AuditLogView } from '@dueltrack/shared';
import { describeAuditEntry } from './describeAuditEntry';

const NO_CONTEXT = {
  round_number: null,
  table_number: null,
  player1_name: null,
  player2_name: null,
  player_name: null,
  user_name: null,
};

function entry(
  action: string,
  detail: Record<string, unknown> = {},
  context: Partial<AuditLogView['context']> = {},
): AuditLogView {
  return {
    id: 'e1',
    tournament_id: 't1',
    actor_id: 'u1',
    action: action as AuditLogView['action'],
    entity_type: null,
    entity_id: null,
    detail,
    created_at: '2026-10-05T10:00:00.000Z',
    actor_display_name: 'Organizer',
    context: { ...NO_CONTEXT, ...context },
  };
}

describe('describeAuditEntry', () => {
  it('names both players, the table and the winner with their score first for a result', () => {
    const e = entry(
      'result.entered',
      { outcome: 'player2_win', player1_game_wins: 1, player2_game_wins: 2, games_drawn: 0 },
      { round_number: 2, table_number: 4, player1_name: 'Alice', player2_name: 'Bob' },
    );
    expect(describeAuditEntry(e)).toBe('Entered result for Round 2, Table 4: Alice vs Bob — Bob won 2–1');
  });

  it('falls back to generic labels when a result has no resolvable pairing context', () => {
    const e = entry('result.entered', { outcome: 'player1_win', player1_game_wins: 2, player2_game_wins: 0 });
    expect(describeAuditEntry(e)).toBe('Entered result: Player 1 vs Player 2 — Player 1 won 2–0');
  });

  it('describes a draw and the non-game outcomes', () => {
    const ctx = { player1_name: 'A', player2_name: 'B' };
    expect(describeAuditEntry(entry('result.entered', { outcome: 'draw', player1_game_wins: 1, player2_game_wins: 1 }, ctx))).toBe(
      'Entered result: A vs B — draw 1–1',
    );
    expect(describeAuditEntry(entry('result.entered', { outcome: 'intentional_draw' }, ctx))).toBe(
      'Entered result: A vs B — intentional draw',
    );
    expect(describeAuditEntry(entry('result.entered', { outcome: 'double_loss' }, ctx))).toBe(
      'Entered result: A vs B — double loss',
    );
  });

  it('says how force-advanced matches were settled, using the count the server writes', () => {
    const e = entry('round.force_advanced', {
      round_number: 4,
      forced_results: 3,
      forced_breakdown: { double_losses: 2, losses_for: ['Alice'] },
      reason: 'Table 5 left',
    });
    expect(describeAuditEntry(e)).toBe(
      'Force-advanced to Round 4 — 3 unfinished matches settled as 2 double losses and a loss for Alice — reason: "Table 5 left"',
    );
  });

  it('falls back to the bare count for force-advance entries written before the breakdown existed', () => {
    const e = entry('round.force_advanced', { round_number: 2, forced_results: 1, reason: 'Late' });
    expect(describeAuditEntry(e)).toBe('Force-advanced to Round 2 — 1 unfinished match given forced results — reason: "Late"');
  });

  it('omits the forced-results part when nothing was forced', () => {
    const e = entry('round.force_advanced', { final_round: 5, tournament_completed: true, forced_results: 0, reason: 'Time' });
    expect(describeAuditEntry(e)).toBe('Force-closed the final round (Round 5) — reason: "Time"');
  });

  it('distinguishes closing the final round from advancing to the next one', () => {
    expect(describeAuditEntry(entry('round.completed', { round_number: 3 }))).toBe(
      'Closed the previous round and paired Round 3',
    );
    expect(describeAuditEntry(entry('round.completed', { final_round: 5, tournament_completed: true }))).toBe(
      'Closed the final round (Round 5) — tournament completed',
    );
  });

  it('appends a pairing-engine warning when present', () => {
    expect(describeAuditEntry(entry('tournament.started', { round_number: 1, warning: 'Rematch unavoidable' }))).toBe(
      'Started the tournament and paired Round 1 (warning: Rematch unavoidable)',
    );
  });

  it('uses the resolved player name for a drop and notes the auto-recorded loss', () => {
    const e = entry('player.dropped', { drop_round: 2, auto_result: { outcome: 'player2_win' } }, { player_name: 'Carol' });
    expect(describeAuditEntry(e)).toBe('Dropped Carol in Round 2 — their open match was recorded as a loss');
  });

  it('names a removed player from the name stored at removal time', () => {
    expect(describeAuditEntry(entry('player.removed', { player_id: 'p9', display_name: 'Frank' }))).toBe('Removed player Frank');
  });

  it('still describes a removed player from an entry that predates the stored name', () => {
    expect(describeAuditEntry(entry('player.removed', { player_id: 'p9' }))).toBe('Removed a player');
  });

  it('labels changed settings the way an organizer would say them', () => {
    expect(describeAuditEntry(entry('tournament.updated', { venue: 'Hall B', scheduled_at: '2026-11-01T10:00:00Z' }))).toBe(
      'Updated tournament settings: venue, start time',
    );
  });

  it('includes drawn games in a score', () => {
    const e = entry(
      'result.entered',
      { outcome: 'draw', player1_game_wins: 1, player2_game_wins: 1, games_drawn: 1 },
      { player1_name: 'A', player2_name: 'B' },
    );
    expect(describeAuditEntry(e)).toBe('Entered result: A vs B — draw 1–1–1');
  });

  it('uses the resolved user name for judge changes', () => {
    expect(describeAuditEntry(entry('judge.assigned', { user_id: 'u2' }, { user_name: 'Dana' }))).toBe('Assigned Dana as a judge');
    expect(describeAuditEntry(entry('judge.removed', { user_id: 'u2' }))).toBe('Removed a judge');
  });

  it('distinguishes an auto-rejected duplicate registration from a manual rejection', () => {
    expect(describeAuditEntry(entry('registration.rejected', { auto_rejected: true }))).toBe(
      'Auto-rejected a duplicate registration (player already registered)',
    );
    expect(describeAuditEntry(entry('registration.rejected', { guest_name: 'Eve' }))).toBe('Rejected the registration of Eve');
  });

  it('never throws on malformed detail and falls back to the raw action for unknown actions', () => {
    expect(describeAuditEntry(entry('standings.published', { round_number: 'x' }))).toBe('Published Round ? standings');
    expect(describeAuditEntry(entry('some.future_action'))).toBe('some.future_action');
  });
});
