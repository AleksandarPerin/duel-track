import { describe, it, expect } from 'vitest';
import { buildHeadToHead, outcomeForSide, type HeadToHeadMatchRow } from './profile.head-to-head.view';
import type { Outcome } from '../standings/standings.engine';

function row(overrides: Partial<HeadToHeadMatchRow> = {}): HeadToHeadMatchRow {
  return {
    pairing_id: 'p1',
    outcome: 'player1_win',
    my_side: 'player1',
    opponent_tp_id: 'tp-opp-1',
    opponent_user_id: null,
    opponent_guest_name: 'Guest One',
    opponent_account_name: null,
    ...overrides,
  };
}

describe('outcomeForSide', () => {
  const cases: Array<[Outcome, 'player1' | 'player2', 'win' | 'loss' | 'draw']> = [
    ['player1_win', 'player1', 'win'],
    ['player1_win', 'player2', 'loss'],
    ['player2_win', 'player1', 'loss'],
    ['player2_win', 'player2', 'win'],
    ['draw', 'player1', 'draw'],
    ['draw', 'player2', 'draw'],
    ['intentional_draw', 'player1', 'draw'],
    ['intentional_draw', 'player2', 'draw'],
    ['double_loss', 'player1', 'loss'],
    ['double_loss', 'player2', 'loss'],
  ];

  for (const [outcome, side, expected] of cases) {
    it(`${outcome} as ${side} -> ${expected}`, () => {
      expect(outcomeForSide(outcome, side)).toBe(expected);
    });
  }
});

describe('buildHeadToHead', () => {
  it('aggregates a linked opponent across different tournament_players rows sharing one user_id', () => {
    const rows = [
      row({ opponent_tp_id: 'tp-a', opponent_user_id: 'u1', opponent_account_name: 'Bob', outcome: 'player1_win', my_side: 'player1' }),
      row({ opponent_tp_id: 'tp-b', opponent_user_id: 'u1', opponent_account_name: 'Bob', outcome: 'player2_win', my_side: 'player1' }),
    ];
    const result = buildHeadToHead(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      opponent_user_id: 'u1',
      opponent_display_name: 'Bob',
      wins: 1,
      losses: 1,
      draws: 0,
      matches_played: 2,
    });
  });

  it('keeps unlinked guest opponents with the same guest_name as separate entries', () => {
    const rows = [
      row({ opponent_tp_id: 'tp-a', opponent_user_id: null, opponent_guest_name: 'Same Name' }),
      row({ opponent_tp_id: 'tp-b', opponent_user_id: null, opponent_guest_name: 'Same Name' }),
    ];
    const result = buildHeadToHead(rows);
    expect(result).toHaveLength(2);
  });

  it('counts matches_played/wins/losses/draws correctly', () => {
    const rows = [
      row({ outcome: 'player1_win', my_side: 'player1' }),
      row({ outcome: 'player1_win', my_side: 'player2' }),
      row({ outcome: 'draw', my_side: 'player1' }),
    ];
    const [entry] = buildHeadToHead(rows);
    expect(entry).toMatchObject({ wins: 1, losses: 1, draws: 1, matches_played: 3 });
  });

  it('sorts by matches_played desc, then wins desc, then display name', () => {
    const many = Array.from({ length: 3 }, () =>
      row({ opponent_tp_id: 'tp-many', opponent_guest_name: 'Many Matches', outcome: 'player1_win', my_side: 'player1' }),
    );
    const fewWins = [row({ opponent_tp_id: 'tp-few-a', opponent_guest_name: 'Zed Fewer', outcome: 'player1_win', my_side: 'player1' })];
    const fewLoss = [row({ opponent_tp_id: 'tp-few-b', opponent_guest_name: 'Amy Fewer', outcome: 'player2_win', my_side: 'player1' })];

    const result = buildHeadToHead([...many, ...fewWins, ...fewLoss]);
    expect(result.map((r) => r.opponent_display_name)).toEqual(['Many Matches', 'Zed Fewer', 'Amy Fewer']);
  });

  it('truncates to the top 10 opponents', () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      row({ opponent_tp_id: `tp-${i}`, opponent_guest_name: `Player ${i}` }),
    );
    expect(buildHeadToHead(rows)).toHaveLength(10);
  });

  it('prefers opponent_account_name over opponent_guest_name when both present', () => {
    const [entry] = buildHeadToHead([
      row({ opponent_account_name: 'Account Name', opponent_guest_name: 'Guest Name' }),
    ]);
    expect(entry.opponent_display_name).toBe('Account Name');
  });

  it('exposes exactly the public head-to-head fields, with no PII or internal ids', () => {
    const [entry] = buildHeadToHead([row()]);
    expect(Object.keys(entry).sort()).toEqual([
      'draws',
      'losses',
      'matches_played',
      'opponent_display_name',
      'opponent_user_id',
      'wins',
    ]);
  });

  it('does not leak guest email or internal tournament_players ids into the response', () => {
    const rows = [
      row({
        opponent_tp_id: 'tp-secret',
        opponent_guest_name: 'Guest One',
        // @ts-expect-error -- exercising a row shape that should never carry PII
        opponent_guest_email: 'guest@example.com',
      }),
    ];
    const [entry] = buildHeadToHead(rows);
    expect(JSON.stringify(entry)).not.toContain('guest@example.com');
    expect(JSON.stringify(entry)).not.toContain('tp-secret');
  });

  it('breaks a tie in both matches_played and wins by display name ascending', () => {
    const zed = row({ opponent_tp_id: 'tp-zed', opponent_guest_name: 'Zed Tie', outcome: 'player1_win', my_side: 'player1' });
    const amy = row({ opponent_tp_id: 'tp-amy', opponent_guest_name: 'Amy Tie', outcome: 'player1_win', my_side: 'player1' });

    const result = buildHeadToHead([zed, amy]);
    expect(result.map((r) => r.opponent_display_name)).toEqual(['Amy Tie', 'Zed Tie']);
  });

  it('aggregates a mix of intentional_draw and double_loss outcomes for the same opponent', () => {
    const rows = [
      row({ opponent_tp_id: 'tp-mix', opponent_guest_name: 'Mixed Opponent', outcome: 'intentional_draw', my_side: 'player1' }),
      row({ opponent_tp_id: 'tp-mix', opponent_guest_name: 'Mixed Opponent', outcome: 'double_loss', my_side: 'player2' }),
      row({ opponent_tp_id: 'tp-mix', opponent_guest_name: 'Mixed Opponent', outcome: 'player2_win', my_side: 'player1' }),
    ];
    const [entry] = buildHeadToHead(rows);
    expect(entry).toMatchObject({ wins: 0, losses: 2, draws: 1, matches_played: 3 });
  });

  it('returns an empty list for no matches', () => {
    expect(buildHeadToHead([])).toEqual([]);
  });
});
