import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { type Session, createTestApp, resetDb, signUp, createTournament, startedTournament } from '../../test/harness';

// As a TO, I can import my player list from a CSV file.
describe('POST /api/tournaments/:id/players/import', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(resetDb);

  async function guests(tournamentId: string) {
    const { rows } = await pool.query<{ guest_name: string; guest_email: string | null }>(
      'SELECT guest_name, guest_email FROM tournament_players WHERE tournament_id = $1 ORDER BY sort_seed',
      [tournamentId],
    );
    return rows;
  }

  async function setup() {
    const organizer = await signUp(app, 'Organizer');
    const t = await createTournament(organizer);
    const importCsv = (csv: string, s: Session = organizer) => s.post(`/api/tournaments/${t.id}/players/import`, csv);
    return { organizer, t, importCsv };
  }

  it('adds a guest player per CSV row and reports a row without a name', async () => {
    const { t, importCsv } = await setup();

    const res = await importCsv('display_name,guest_email\nAna Petrova,ana@example.test\n"Smith, Bo",\n,nobody@example.test\n');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imported: 2, errors: [{ row: 4 }] });
    expect(await guests(t.id)).toEqual([
      { guest_name: 'Ana Petrova', guest_email: 'ana@example.test' },
      { guest_name: 'Smith, Bo', guest_email: null },
    ]);
  });

  it('accepts a 100-character name and reports a 101-character one', async () => {
    const { t, importCsv } = await setup();
    const res = await importCsv(`display_name\n${'a'.repeat(100)}\n${'b'.repeat(101)}\n`);
    expect(res.json()).toEqual({ imported: 1, skipped: 0, errors: [{ row: 3, message: 'display_name exceeds 100 characters' }], skipped_rows: [] });
    expect(await guests(t.id)).toHaveLength(1);
  });

  it('reports an invalid email', async () => {
    const { importCsv } = await setup();
    const res = await importCsv('display_name,guest_email\nAna,bad-email\n');
    expect(res.json()).toEqual({ imported: 0, skipped: 0, errors: [{ row: 2, message: 'guest_email is not a valid email address' }], skipped_rows: [] });
  });

  it('skips a name repeated within the file, ignoring case, and says which row and why', async () => {
    const { t, importCsv } = await setup();
    const res = await importCsv('display_name\nAna\nana\n');
    expect(res.json()).toMatchObject({
      imported: 1, skipped: 1, skipped_rows: [{ row: 3, message: 'same name as an earlier row in this file' }],
    });
    expect(await guests(t.id)).toHaveLength(1);
  });

  it('skips names already in the tournament, so importing the same file twice adds nobody new', async () => {
    const { t, importCsv } = await setup();
    await importCsv('display_name\nAna\nBo\n');

    const res = await importCsv('display_name\nANA\nBo\nCy\n');

    expect(res.json()).toMatchObject({
      imported: 1,
      skipped: 2,
      skipped_rows: [
        { row: 2, message: 'a player with this name is already in the tournament' },
        { row: 3, message: 'a player with this name is already in the tournament' },
      ],
    });
    expect((await guests(t.id)).map((g) => g.guest_name)).toEqual(['Ana', 'Bo', 'Cy']);
  });

  it('matches existing names the same way as names within the file (Unicode case and normalization)', async () => {
    const { t, importCsv } = await setup();
    // Final sigma: JS lowercases 'ΟΔΟΣ' to 'οδος', Postgres to 'οδοσ'.
    // 'José' imported precomposed (NFC), re-imported decomposed (NFD) — every
    // ingress path already NFC-normalizes, so this mostly exercises parseCsv.
    await importCsv('display_name\nΟΔΟΣ\nJos\u00e9\n');

    const res = await importCsv('display_name\nοδος\nJose\u0301\n');

    expect(res.json()).toMatchObject({ imported: 0, skipped: 2 });
    expect(await guests(t.id)).toHaveLength(2);
  });

  it("skips a name matching a linked account's display name", async () => {
    const { organizer, t, importCsv } = await setup();
    const alex = await signUp(app, 'Alex Linked');
    expect((await organizer.post(`/api/tournaments/${t.id}/players`, { type: 'user', user_id: alex.user!.id })).statusCode).toBe(201);

    const res = await importCsv('display_name\nalex linked\n');

    expect(res.json()).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('finds the email column in any position and stores emails in lower case', async () => {
    const { t, importCsv } = await setup();
    await importCsv('guest_email,display_name\nANA@Example.TEST,Ana\n');
    expect(await guests(t.id)).toEqual([{ guest_name: 'Ana', guest_email: 'ana@example.test' }]);
  });

  it('unescapes doubled quotes in a quoted field', async () => {
    const { t, importCsv } = await setup();
    await importCsv('display_name\n"Bo ""The Hammer"" Smith"\n');
    expect(await guests(t.id)).toEqual([{ guest_name: 'Bo "The Hammer" Smith', guest_email: null }]);
  });

  it('rejects a file with only a header row', async () => {
    const { importCsv } = await setup();
    const res = await importCsv('display_name\n');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_CSV' });
  });

  it('refuses to import into a tournament that has started, writing nothing', async () => {
    const organizer = await signUp(app, 'Organizer');
    const t = await startedTournament(organizer);
    const res = await organizer.post(`/api/tournaments/${t.id}/players/import`, 'display_name\nLate\n');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'TOURNAMENT_NOT_EDITABLE' });
    expect(await guests(t.id)).toHaveLength(8);
  });
});
