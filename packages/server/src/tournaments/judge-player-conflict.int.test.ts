import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { pool } from '../db/pool';
import {
  type Session, createTestApp, resetDb, signUp, createTournament, assignJudge, selfRegister,
} from '../../test/harness';

// As a TO, I can rely on nobody being both a judge and a player in my
// tournament, whichever way they are added. Judges can enter any result, so
// a judge who also plays could report their own match.
//
// This is DuelTrack's own rule, stricter than the MTR: §1.4 lets officials
// play in non-Premier events run at Regular REL, and also lets a TO set
// their own participation rules. Chosen by the product owner on 2026-10-27;
// assignJudge, submitRegistration and the profile claim/link paths already
// enforce it.
describe('a tournament judge cannot also be a player', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  async function playerRows(tournamentId: string, userId: string) {
    const { rows } = await pool.query(
      'SELECT 1 FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, userId],
    );
    return rows.length;
  }

  // Two ways a registered user becomes a player. Each returns the tournament,
  // the user and a function performing the "make them a player" request.
  const paths = {
    'organizer adds a registered user as a player': async (organizer: Session, user: Session) => {
      const t = await createTournament(organizer);
      const act = () => organizer.post(`/api/tournaments/${t.id}/players`, { type: 'user', user_id: user.user!.id });
      return { t, act, ok: 201 };
    },
    'organizer approves a self-registration': async (organizer: Session, user: Session) => {
      const t = await createTournament(organizer);
      const reg = await selfRegister(organizer, t.id, user);
      const act = () => organizer.post(`/api/tournaments/${t.id}/registrations/${reg.id}/decision`, { decision: 'approved' });
      return { t, act, ok: 200, reg };
    },
  };

  // Product decision 2026-10-27: rather than let the conflict surface only
  // when the organizer clicks Approve, refuse the judge assignment while the
  // user has a pending sign-up. Once it is decided the assignment works again
  // (an approved player is refused by the existing player check).
  describe('assigning a judge who has a pending self-registration', () => {
    it('is refused, with no judge row written', async () => {
      const organizer = await signUp(app, 'Organizer');
      const user = await signUp(app, 'Registrant');
      const t = await createTournament(organizer);
      await selfRegister(organizer, t.id, user);

      const res = await organizer.post(`/api/tournaments/${t.id}/judges`, { user_id: user.user!.id });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'JUDGE_HAS_PENDING_REGISTRATION' });
      const { rows } = await pool.query('SELECT 1 FROM tournament_judges WHERE tournament_id = $1', [t.id]);
      expect(rows).toHaveLength(0);
    });

    it('works once the registration has been rejected', async () => {
      const organizer = await signUp(app, 'Organizer');
      const user = await signUp(app, 'Registrant');
      const t = await createTournament(organizer);
      const reg = await selfRegister(organizer, t.id, user);
      await organizer.post(`/api/tournaments/${t.id}/registrations/${reg.id}/decision`, { decision: 'rejected' });

      const res = await organizer.post(`/api/tournaments/${t.id}/judges`, { user_id: user.user!.id });

      expect(res.statusCode).toBe(201);
    });

    it('is not affected by a pending registration in a different tournament', async () => {
      const organizer = await signUp(app, 'Organizer');
      const user = await signUp(app, 'Registrant');
      const t = await createTournament(organizer);
      const other = await createTournament(organizer);
      await selfRegister(organizer, other.id, user);

      const res = await organizer.post(`/api/tournaments/${t.id}/judges`, { user_id: user.user!.id });

      expect(res.statusCode).toBe(201);
    });
  });

  describe.each(Object.entries(paths))('%s', (_name, prepare) => {
    it('is refused for a judge of the tournament, with nothing written', async () => {
      const organizer = await signUp(app, 'Organizer');
      const user = await signUp(app, 'Judge');
      const { t, act, reg } = await prepare(organizer, user);
      if (reg) {
        // assignJudge now refuses a user with a pending registration, so a
        // judge reaches this approval only by racing it; seed that state.
        await pool.query(
          'INSERT INTO tournament_judges (tournament_id, user_id, assigned_by) VALUES ($1, $2, $3)',
          [t.id, user.user!.id, organizer.user!.id],
        );
      } else {
        await assignJudge(organizer, t.id, user);
      }

      const res = await act();

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'PLAYER_IS_JUDGE' });
      expect(await playerRows(t.id, user.user!.id)).toBe(0);
      if (reg) {
        const { rows } = await pool.query('SELECT status FROM tournament_registrations WHERE id = $1', [reg.id]);
        expect(rows[0]).toEqual({ status: 'pending' });
      }
    });

    it('still works for a user who is not a judge', async () => {
      const organizer = await signUp(app, 'Organizer');
      const user = await signUp(app, 'Player');
      const { t, act, ok } = await prepare(organizer, user);

      expect((await act()).statusCode).toBe(ok);
      expect(await playerRows(t.id, user.user!.id)).toBe(1);
    });

    it('still works for a judge of a different tournament', async () => {
      const organizer = await signUp(app, 'Organizer');
      const user = await signUp(app, 'Judge Elsewhere');
      const { t, act, ok } = await prepare(organizer, user);
      const other = await createTournament(organizer);
      await assignJudge(organizer, other.id, user);

      expect((await act()).statusCode).toBe(ok);
      expect(await playerRows(t.id, user.user!.id)).toBe(1);
    });

    // assignJudge takes the judge/player advisory lock and then, through its
    // tournament_judges foreign key, a share lock on the tournament row. This
    // path must take the advisory lock first too, or the two deadlock. Holding
    // the advisory lock here stands in for a concurrent assignJudge.
    it('waits for a concurrent judge assignment before locking the tournament, then refuses', async () => {
      const organizer = await signUp(app, 'Organizer');
      const user = await signUp(app, 'Racing Judge');
      const { t, act } = await prepare(organizer, user);

      const assigning = await pool.connect();
      try {
        await assigning.query('BEGIN');
        await assigning.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          'judge-player-conflict', `${t.id}:${user.user!.id}`,
        ]);

        let settled: LightMyRequestResponse | null = null;
        const pending = act().then((res) => { settled = res; return res; });
        await new Promise((r) => setTimeout(r, 300));
        expect(settled).toBeNull();

        const probe = await pool.connect();
        try {
          await probe.query('BEGIN');
          // NOWAIT fails at once if the request already holds the tournament row.
          await expect(
            probe.query('SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE NOWAIT', [t.id]),
          ).resolves.toBeDefined();
        } finally {
          await probe.query('ROLLBACK');
          probe.release();
        }

        await assigning.query(
          'INSERT INTO tournament_judges (tournament_id, user_id, assigned_by) VALUES ($1, $2, $3)',
          [t.id, user.user!.id, organizer.user!.id],
        );
        await assigning.query('COMMIT');

        const res = await pending;
        expect(res.statusCode).toBe(409);
        expect(await playerRows(t.id, user.user!.id)).toBe(0);
      } finally {
        await assigning.query('ROLLBACK').catch(() => {});
        assigning.release();
      }
    });
  });
});
