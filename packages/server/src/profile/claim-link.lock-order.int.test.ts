import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { pool } from '../db/pool';
import { lockTournamentUserPair } from '../db/advisoryLock';
import { type Session, createTestApp, resetDb, signUp, createTournament, expectStatus } from '../../test/harness';

// Lock order (see db/advisoryLock.ts): the judge/player advisory lock comes
// before any tournaments or tournament_players row lock. Claim and link used
// to lock the player row first, which deadlocked against a path holding the
// advisory lock while waiting for a tournament row that a third request (e.g.
// reorderSeeds) held while waiting for that player row.
describe('claiming or linking a guest record takes the judge/player lock first', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  // A guest row whose email is `user`'s, in a tournament run by `organizer`.
  async function guestRecordFor(organizer: Session, user: Session) {
    const t = await createTournament(organizer);
    const res = await organizer.post(`/api/tournaments/${t.id}/players`, {
      type: 'guest', guest_name: 'Walk-in', guest_email: user.user!.email,
    });
    expectStatus(res, 201, 'add guest');
    return { tournamentId: t.id, playerId: res.json<{ id: string }>().id };
  }

  const paths = {
    'the player claims it': (organizer: Session, user: Session, t: string, p: string) =>
      user.post(`/api/profile/claimable-players/${p}/claim`, {}),
    'the organizer links it': (organizer: Session, user: Session, t: string, p: string) =>
      organizer.post(`/api/tournaments/${t}/players/${p}/link`, { user_id: user.user!.id }),
  };

  it.each(Object.entries(paths))('when %s, it waits for the advisory lock before locking the player row', async (_n, act) => {
    const organizer = await signUp(app, 'Organizer');
    const user = await signUp(app, 'Guest Owner');
    const { tournamentId, playerId } = await guestRecordFor(organizer, user);

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await lockTournamentUserPair(holder, tournamentId, user.user!.id);

      let settled: LightMyRequestResponse | null = null;
      const pending = act(organizer, user, tournamentId, playerId).then((r) => { settled = r; return r; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBeNull();

      const probe = await pool.connect();
      try {
        await probe.query('BEGIN');
        await expect(
          probe.query('SELECT 1 FROM tournament_players WHERE id = $1 FOR UPDATE NOWAIT', [playerId]),
        ).resolves.toBeDefined();
      } finally {
        await probe.query('ROLLBACK');
        probe.release();
      }

      await holder.query('COMMIT');
      expect((await pending).statusCode).toBe(200);
      const { rows } = await pool.query('SELECT user_id FROM tournament_players WHERE id = $1', [playerId]);
      expect(rows[0]).toEqual({ user_id: user.user!.id });
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  });
});
