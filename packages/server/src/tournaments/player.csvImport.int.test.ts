import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { createTestApp, resetDb, signUp, createTournament } from '../../test/harness';

// As a TO, I can import my player list from a CSV file.
describe('POST /api/tournaments/:id/players/import', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  it('adds a guest player per CSV row and reports a row without a name', async () => {
    const organizer = await signUp(app, 'Organizer');
    const t = await createTournament(organizer);

    const res = await organizer.post(
      `/api/tournaments/${t.id}/players/import`,
      'display_name,guest_email\nAna Petrova,ana@example.test\n"Smith, Bo",\n,nobody@example.test\n',
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imported: 2, errors: [{ row: 4 }] });
    const { rows } = await pool.query(
      'SELECT guest_name, guest_email FROM tournament_players WHERE tournament_id = $1 ORDER BY sort_seed',
      [t.id],
    );
    expect(rows).toEqual([
      { guest_name: 'Ana Petrova', guest_email: 'ana@example.test' },
      { guest_name: 'Smith, Bo', guest_email: null },
    ]);
  });
});
