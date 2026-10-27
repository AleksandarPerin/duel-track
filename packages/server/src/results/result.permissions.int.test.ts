import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import {
  Session, createTestApp, resetDb, signUp, startedTournament, expectStatus,
} from '../../test/harness';

// As a TO, I can let my assigned judges enter match results, while players,
// strangers and signed-out visitors cannot.
describe('POST /api/tournaments/:id/pairings/:pairingId/result — who may enter a result', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  const result = { outcome: 'player1_win', player1_game_wins: 2, player2_game_wins: 0, games_drawn: 0 };

  async function setup() {
    const organizer = await signUp(app, 'Organizer');
    const t = await startedTournament(organizer);
    const pairing = t.pairings.find((p) => !p.is_bye)!;
    const url = `/api/tournaments/${t.id}/pairings/${pairing.id}/result`;
    return { organizer, t, url };
  }

  it('lets the organizer enter a result', async () => {
    const { organizer, url } = await setup();
    const res = await organizer.post(url, result);
    expect(res.statusCode).toBe(201);
  });

  it('lets a judge assigned to the tournament enter a result', async () => {
    const { organizer, t, url } = await setup();
    const judge = await signUp(app, 'Judge');
    expectStatus(await organizer.post(`/api/tournaments/${t.id}/judges`, { user_id: judge.user!.id }), 201, 'assign judge');
    const res = await judge.post(url, result);
    expect(res.statusCode).toBe(201);
  });

  it('refuses a signed-in user who is not the organizer or a judge', async () => {
    const { url } = await setup();
    const stranger = await signUp(app, 'Stranger');
    const res = await stranger.post(url, result);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('refuses a judge of a different tournament', async () => {
    const { url } = await setup();
    const otherOrganizer = await signUp(app, 'Other Organizer');
    const other = await startedTournament(otherOrganizer);
    const judge = await signUp(app, 'Other Judge');
    expectStatus(await otherOrganizer.post(`/api/tournaments/${other.id}/judges`, { user_id: judge.user!.id }), 201, 'assign judge');
    const res = await judge.post(url, result);
    expect(res.statusCode).toBe(403);
  });

  it('refuses a signed-out visitor', async () => {
    const { url } = await setup();
    const anonymous = new Session(app);
    const res = await anonymous.post(url, result);
    expect(res.statusCode).toBe(401);
  });

  // The judge/player rule should make this state impossible; if a row ever
  // slips through, the judge still must not report their own match.
  it('refuses a judge entering the result of a match they play in', async () => {
    const { organizer, t } = await setup();
    const judge = await signUp(app, 'Judge Player');
    expectStatus(await organizer.post(`/api/tournaments/${t.id}/judges`, { user_id: judge.user!.id }), 201, 'assign judge');
    const own = t.pairings.find((p) => !p.is_bye)!;
    await pool.query(
      'UPDATE tournament_players SET user_id = $1 WHERE id = (SELECT player1_id FROM pairings WHERE id = $2)',
      [judge.user!.id, own.id],
    );

    const res = await judge.post(`/api/tournaments/${t.id}/pairings/${own.id}/result`, result);

    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query('SELECT 1 FROM results');
    expect(rows).toHaveLength(0);
  });

  it('stores nothing when the request is refused', async () => {
    const { url } = await setup();
    const stranger = await signUp(app, 'Stranger');
    await stranger.post(url, result);
    await new Session(app).post(url, result);
    const { rows } = await pool.query('SELECT 1 FROM results');
    expect(rows).toHaveLength(0);
  });
});
