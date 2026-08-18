import { describe, it, expect } from 'vitest';
import { toPlayerView } from './profile.view';
import type { GuestPlayerRow } from './profile.view';

function guestRow(overrides: Partial<GuestPlayerRow> = {}): GuestPlayerRow {
  return {
    id: 'tp1',
    tournament_id: 't1',
    user_id: null,
    sort_seed: 4,
    byes_received: 1,
    status: 'active',
    drop_round: null,
    created_at: '2026-01-01T00:00:00.000Z',
    display_name: 'Ali Walkin',
    guest_name: 'Ali Walkin',
    guest_email: 'alice@example.com',
    ...overrides,
  };
}

describe('toPlayerView', () => {
  it('omits guest_email and guest_name from the projected view', () => {
    const view = toPlayerView(guestRow(), 'Alice Account');
    expect(view).not.toHaveProperty('guest_email');
    expect(view).not.toHaveProperty('guest_name');
  });

  it('exposes exactly the public player fields', () => {
    const view = toPlayerView(guestRow(), 'Alice Account');
    expect(Object.keys(view).sort()).toEqual([
      'byes_received',
      'created_at',
      'display_name',
      'drop_round',
      'id',
      'sort_seed',
      'status',
      'tournament_id',
      'user_id',
    ]);
  });

  it('prefers the account display name over the stored guest name', () => {
    const view = toPlayerView(guestRow(), 'Alice Account');
    expect(view.display_name).toBe('Alice Account');
  });

  it('preserves dropped and disqualified player state', () => {
    const dropped = toPlayerView(guestRow({ status: 'dropped', drop_round: 2 }), 'Alice Account');
    expect(dropped.status).toBe('dropped');
    expect(dropped.drop_round).toBe(2);

    const dq = toPlayerView(guestRow({ status: 'disqualified' }), 'Alice Account');
    expect(dq.status).toBe('disqualified');
  });

  it('does not leak guest_email even when the row carries a mixed-case address', () => {
    const view = toPlayerView(guestRow({ guest_email: 'Alice@Example.COM' }), 'Alice Account');
    expect(JSON.stringify(view)).not.toContain('Example.COM');
  });
});
