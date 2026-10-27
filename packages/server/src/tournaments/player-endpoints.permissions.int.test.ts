import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import {
  Session, createTestApp, resetDb, signUp, createTournament, assignJudge, selfRegister,
} from '../../test/harness';

// As a TO, I am the only one who can add players to my tournament or approve
// sign-ups; my judges, other users and signed-out visitors cannot.
describe('who may add players or decide registrations', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  async function count(sql: string, params: unknown[]) {
    return (await pool.query(sql, params)).rows.length;
  }

  // Each endpoint: set up a tournament, return the request a caller makes and
  // a probe for whether anything was written.
  const endpoints = {
    'POST /api/tournaments/:id/players (registered user)': async (organizer: Session) => {
      const t = await createTournament(organizer);
      const target = await signUp(app, 'Target');
      return {
        t,
        ok: 201,
        call: (s: Session) => s.post(`/api/tournaments/${t.id}/players`, { type: 'user', user_id: target.user!.id }),
        written: () => count('SELECT 1 FROM tournament_players WHERE tournament_id = $1', [t.id]),
      };
    },
    'POST /api/tournaments/:id/players (guest)': async (organizer: Session) => {
      const t = await createTournament(organizer);
      return {
        t,
        ok: 201,
        call: (s: Session) => s.post(`/api/tournaments/${t.id}/players`, { type: 'guest', guest_name: 'Walk-in' }),
        written: () => count('SELECT 1 FROM tournament_players WHERE tournament_id = $1', [t.id]),
      };
    },
    'POST /api/tournaments/:id/registrations/:rid/decision': async (organizer: Session) => {
      const t = await createTournament(organizer);
      const reg = await selfRegister(organizer, t.id, await signUp(app, 'Registrant'));
      return {
        t,
        ok: 200,
        call: (s: Session) => s.post(`/api/tournaments/${t.id}/registrations/${reg.id}/decision`, { decision: 'approved' }),
        written: async () =>
          (await count('SELECT 1 FROM tournament_players WHERE tournament_id = $1', [t.id]))
          + (await count("SELECT 1 FROM tournament_registrations WHERE id = $1 AND status <> 'pending'", [reg.id])),
      };
    },
  };

  describe.each(Object.entries(endpoints))('%s', (_name, prepare) => {
    it('lets the organizer', async () => {
      const organizer = await signUp(app, 'Organizer');
      const { call, ok } = await prepare(organizer);
      expect((await call(organizer)).statusCode).toBe(ok);
    });

    it.each([
      ['a judge assigned to the tournament', 403],
      ['a signed-in stranger', 403],
      ['a signed-out visitor', 401],
    ])('refuses %s, with nothing written', async (who, status) => {
      const organizer = await signUp(app, 'Organizer');
      const { t, call, written } = await prepare(organizer);
      let caller: Session;
      if (who.startsWith('a judge')) {
        caller = await signUp(app, 'Judge');
        await assignJudge(organizer, t.id, caller);
      } else if (who.startsWith('a signed-in')) {
        caller = await signUp(app, 'Stranger');
      } else {
        caller = new Session(app);
      }

      const res = await call(caller);

      expect(res.statusCode).toBe(status);
      expect(await written()).toBe(0);
    });
  });
});
