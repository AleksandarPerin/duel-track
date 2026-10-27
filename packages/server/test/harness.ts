import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { pool } from '../src/db/pool';
import { redis } from '../src/db/redis';

// Integration-test harness: the real app (buildApp) driven through
// app.inject(), against the migrated test database. See vitest.config.ts.

// One app per test file: app.close() ends the module-level Postgres pool and
// Redis clients, which a second buildApp() in the same file cannot reopen.
// Create it in a file-level beforeAll and close it in the matching afterAll.
export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

// Empties every table except the migrations log, and the test Redis
// database (rate-limit counters). Call in beforeEach. Refuses to run unless
// connected to a *_test Postgres database and a non-zero Redis database.
export async function resetDb(): Promise<void> {
  const { rows: [db] } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  if (!db!.name.endsWith('_test')) {
    throw new Error(`resetDb refused: connected to "${db!.name}", not a *_test database`);
  }
  if (!redis.options.db) {
    throw new Error('resetDb refused: Redis is on database 0; point TEST_REDIS_URL at a separate database (e.g. /15)');
  }
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`,
  );
  if (rows.length > 0) {
    await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await redis.flushdb();
}

// A string body is sent as text/plain (e.g. CSV import); anything else as JSON.
type Body = Record<string, unknown> | unknown[] | string;

// A browser-like client: keeps cookies between requests (sent only under
// their Path, as a browser does) and sends the double-submit CSRF header on
// mutating requests, as the SPA does.
export class Session {
  private cookies = new Map<string, { value: string; path: string }>();
  private csrf: string | null = null;
  user: { id: string; email: string; display_name: string } | null = null;

  constructor(private readonly app: FastifyInstance) {}

  async request(method: InjectOptions['method'], url: string, body?: Body): Promise<LightMyRequestResponse> {
    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating && this.csrf === null) {
      const res = await this.raw('GET', '/api/auth/csrf');
      this.csrf = res.json<{ csrfToken: string }>().csrfToken;
    }
    return this.raw(method, url, body, mutating);
  }

  get(url: string) { return this.request('GET', url); }
  post(url: string, body?: Body) { return this.request('POST', url, body ?? {}); }
  patch(url: string, body?: Body) { return this.request('PATCH', url, body ?? {}); }
  delete(url: string) { return this.request('DELETE', url); }

  private async raw(method: InjectOptions['method'], url: string, body?: Body, withCsrf = false) {
    const pathname = url.split('?')[0]!;
    const sent = [...this.cookies]
      .filter(([, c]) => pathname === c.path || pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`))
      .map(([name, c]) => `${name}=${c.value}`);
    const res = await this.app.inject({
      method,
      url,
      payload: body as InjectOptions['payload'],
      headers: {
        ...(typeof body === 'string' ? { 'content-type': 'text/plain' } : {}),
        ...(sent.length ? { cookie: sent.join('; ') } : {}),
        ...(withCsrf && this.csrf ? { 'x-csrf-token': this.csrf } : {}),
      },
    });
    for (const c of res.cookies) {
      const expired = c.value === '' || c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now());
      if (expired) this.cookies.delete(c.name);
      else this.cookies.set(c.name, { value: c.value, path: c.path ?? '/' });
      // A new or cleared CSRF secret invalidates the cached token.
      if (c.name === '_csrf') this.csrf = null;
    }
    return res;
  }
}

let userSeq = 0;

// Registers and signs in a new user; returns their session.
export async function signUp(app: FastifyInstance, name = `User ${++userSeq}`): Promise<Session> {
  const s = new Session(app);
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${Date.now()}.${++userSeq}@example.test`;
  const password = 'correct-horse-battery-9';
  const reg = await s.post('/api/auth/register', { email, display_name: name, password });
  expectStatus(reg, 201, 'register');
  const login = await s.post('/api/auth/login', { email, password });
  expectStatus(login, 200, 'login');
  s.user = reg.json();
  return s;
}

export function expectStatus(res: LightMyRequestResponse, status: number, what: string): void {
  if (res.statusCode !== status) {
    throw new Error(`${what}: expected HTTP ${status}, got ${res.statusCode} ${res.body}`);
  }
}

// Creates a tournament owned by `organizer` with `guests` guest players.
export async function createTournament(
  organizer: Session,
  { guests = 0, totalRounds = 3 }: { guests?: number; totalRounds?: number } = {},
): Promise<{ id: string; playerIds: string[] }> {
  const res = await organizer.post('/api/tournaments', {
    name: 'Integration Cup', format: 'modern', total_rounds: totalRounds, top_cut: 0,
  });
  expectStatus(res, 201, 'create tournament');
  const { id } = res.json<{ id: string }>();
  const playerIds: string[] = [];
  for (let i = 1; i <= guests; i++) {
    const p = await organizer.post(`/api/tournaments/${id}/players`, { type: 'guest', guest_name: `Guest ${i}` });
    expectStatus(p, 201, 'add guest player');
    playerIds.push(p.json<{ id: string }>().id);
  }
  return { id, playerIds };
}

// Creates and starts an 8-guest tournament; returns its round-1 pairings.
export async function startedTournament(organizer: Session) {
  const t = await createTournament(organizer, { guests: 8 });
  const res = await organizer.post(`/api/tournaments/${t.id}/start`);
  expectStatus(res, 201, 'start tournament');
  const { pairings } = res.json<{ pairings: { id: string; is_bye: boolean }[] }>();
  return { ...t, pairings };
}

export async function assignJudge(organizer: Session, tournamentId: string, judge: Session): Promise<void> {
  expectStatus(
    await organizer.post(`/api/tournaments/${tournamentId}/judges`, { user_id: judge.user!.id }),
    201, 'assign judge',
  );
}

// Opens registration and submits a signed-in self-registration for `user`;
// returns the pending registration.
export async function selfRegister(organizer: Session, tournamentId: string, user: Session): Promise<{ id: string }> {
  expectStatus(await organizer.post(`/api/tournaments/${tournamentId}/registration/open`), 200, 'open registration');
  const link = await organizer.get(`/api/tournaments/${tournamentId}/registration-link`);
  expectStatus(link, 200, 'registration link');
  expectStatus(await user.post(`/api/public/register/${link.json<{ token: string }>().token}`, {}), 201, 'self-register');
  const list = await organizer.get(`/api/tournaments/${tournamentId}/registrations`);
  expectStatus(list, 200, 'list registrations');
  const regs = list.json<{ id: string; user_id: string | null }[]>();
  const reg = regs.find((r) => r.user_id === user.user!.id);
  if (!reg) throw new Error('self-register: registration not found in the organizer list');
  return reg;
}
