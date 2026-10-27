import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { Session, createTestApp, resetDb, signUp, createTournament, assignJudge, expectStatus } from '../../test/harness';

// As a TO, I am warned when a signed-out sign-up uses the email of one of my
// judges, and I decide whether to approve or reject it. The judge/player rule
// binds accounts; a guest row has no account, so this is a warning, not a
// refusal (product decision 2026-10-27).
describe('guest sign-up whose email matches a judge', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  async function setup() {
    const organizer = await signUp(app, 'Organizer');
    const judge = await signUp(app, 'Judge');
    const t = await createTournament(organizer);
    await assignJudge(organizer, t.id, judge);
    expectStatus(await organizer.post(`/api/tournaments/${t.id}/registration/open`), 200, 'open registration');
    const { token } = (await organizer.get(`/api/tournaments/${t.id}/registration-link`)).json<{ token: string }>();
    const guestSignUp = async (name: string, email: string) =>
      expectStatus(await new Session(app).post(`/api/public/register/${token}`, { guest_name: name, guest_email: email }), 201, 'guest sign-up');
    return { organizer, judge, t, guestSignUp };
  }

  it('is flagged in the organizer list, matching the email in any case', async () => {
    const { organizer, judge, t, guestSignUp } = await setup();
    await guestSignUp('Judge Incognito', judge.user!.email.toUpperCase());
    await guestSignUp('Someone Else', 'someone.else@example.test');

    const list = (await organizer.get(`/api/tournaments/${t.id}/registrations`))
      .json<{ display_name: string; email_matches_judge: boolean }[]>();

    expect(list.map((r) => [r.display_name, r.email_matches_judge])).toEqual([
      ['Judge Incognito', true],
      ['Someone Else', false],
    ]);
  });

  it('is not flagged for the email of a judge of a different tournament', async () => {
    const { organizer, t, guestSignUp } = await setup();
    const otherJudge = await signUp(app, 'Other Judge');
    const other = await createTournament(organizer);
    await assignJudge(organizer, other.id, otherJudge);
    await guestSignUp('Elsewhere Judge', otherJudge.user!.email);

    const list = (await organizer.get(`/api/tournaments/${t.id}/registrations`)).json<{ email_matches_judge: boolean }[]>();

    expect(list.map((r) => r.email_matches_judge)).toEqual([false]);
  });

  it('matches a stored guest email in any letter case', async () => {
    // Sign-up lowercases emails, so seed a mixed-case row directly to pin the query.
    const { organizer, judge, t } = await setup();
    await pool.query(
      `INSERT INTO tournament_registrations (tournament_id, guest_name, guest_email, status)
       VALUES ($1, 'Legacy Row', $2, 'pending')`,
      [t.id, judge.user!.email.toUpperCase()],
    );

    const list = (await organizer.get(`/api/tournaments/${t.id}/registrations`)).json<{ email_matches_judge: boolean }[]>();

    expect(list.map((r) => r.email_matches_judge)).toEqual([true]);
  });

  it('can still be approved by the organizer', async () => {
    const { organizer, judge, t, guestSignUp } = await setup();
    await guestSignUp('Judge Incognito', judge.user!.email);
    const [reg] = (await organizer.get(`/api/tournaments/${t.id}/registrations`)).json<{ id: string }[]>();

    const res = await organizer.post(`/api/tournaments/${t.id}/registrations/${reg!.id}/decision`, { decision: 'approved' });

    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query('SELECT guest_name FROM tournament_players WHERE tournament_id = $1', [t.id]);
    expect(rows).toEqual([{ guest_name: 'Judge Incognito' }]);
  });
});
