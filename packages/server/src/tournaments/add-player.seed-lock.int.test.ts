import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { pool } from '../db/pool';
import { createTestApp, resetDb, signUp, createTournament } from '../../test/harness';

// Seeds are allocated as MAX(sort_seed) + 1 under the tournaments row lock;
// without it, two players added at the same moment get the same seed (there
// is no unique constraint on (tournament_id, sort_seed)).
describe('adding a player waits for the tournament row lock', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  it('so concurrent adds get distinct seeds', async () => {
    const organizer = await signUp(app, 'Organizer');
    const t = await createTournament(organizer, { guests: 1 });

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE', [t.id]);

      let settled: LightMyRequestResponse | null = null;
      const pending = organizer.post(`/api/tournaments/${t.id}/players`, { type: 'guest', guest_name: 'Late' })
        .then((r) => { settled = r; return r; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBeNull();

      // Simulate a concurrent add committing first while the request waits.
      await holder.query(
        `INSERT INTO tournament_players (tournament_id, guest_name, sort_seed)
         SELECT $1, 'Concurrent', COALESCE(MAX(sort_seed), 0) + 1 FROM tournament_players WHERE tournament_id = $1`,
        [t.id],
      );
      await holder.query('COMMIT');

      expect((await pending).statusCode).toBe(201);
      const { rows } = await pool.query<{ sort_seed: number }>(
        'SELECT sort_seed FROM tournament_players WHERE tournament_id = $1 ORDER BY sort_seed', [t.id],
      );
      expect(rows.map((r) => r.sort_seed)).toEqual([1, 2, 3]);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  });
});
