import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Session, createTestApp, resetDb, expectStatus } from '../../test/harness';
import { seedDemo, DEMO_ORGANIZER } from './seedDemo';

// As someone trying DuelTrack locally, I can seed a demo, then log in as its
// organizer in the browser, see the tournament on my dashboard and start it
// (the UI has no sign-up or create-tournament screen yet).
describe('demo seed', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  it('creates an organizer who can log in, see the tournament and start it', async () => {
    const { tournamentId } = await seedDemo();

    const organizer = new Session(app);
    expectStatus(
      await organizer.post('/api/auth/login', { email: DEMO_ORGANIZER.email, password: DEMO_ORGANIZER.password }),
      200, 'login',
    );
    const dashboard = await organizer.get('/api/profile/assignments');
    expectStatus(dashboard, 200, 'dashboard');
    expect(dashboard.json()).toEqual([
      expect.objectContaining({ tournament_id: tournamentId, is_organizer: true, tournament_status: 'draft' }),
    ]);
    // Starting needs at least 8 active players.
    expectStatus(await organizer.post(`/api/tournaments/${tournamentId}/start`), 201, 'start tournament');
  });

  it('records the setup in the audit log, as the API does', async () => {
    const { tournamentId } = await seedDemo();

    const organizer = new Session(app);
    expectStatus(
      await organizer.post('/api/auth/login', { email: DEMO_ORGANIZER.email, password: DEMO_ORGANIZER.password }),
      200, 'login',
    );
    const res = await organizer.get(`/api/tournaments/${tournamentId}/audit`);
    expectStatus(res, 200, 'audit log');
    const actions = res.json<{ entries: { action: string }[] }>().entries.map((e) => e.action);
    expect(actions.filter((a) => a === 'tournament.created')).toHaveLength(1);
    expect(actions.filter((a) => a === 'player.added')).toHaveLength(8);
  });

  it('refuses to seed twice, so a second run cannot create a duplicate tournament', async () => {
    await seedDemo();
    await expect(seedDemo()).rejects.toThrow(/already seeded/);
  });

  it('refuses a database that is not on this machine, whatever NODE_ENV says', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://dueltrack:secret@db.staging.example.com:5432/dueltrack');
    try {
      await expect(seedDemo()).rejects.toThrow(/local database/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses to run in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await expect(seedDemo()).rejects.toThrow(/production/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
