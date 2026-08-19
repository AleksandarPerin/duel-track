import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { pool } from '../db/pool';
import { optionalAuthenticate } from '../middleware/authenticate';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from '../audit/audit.service';
import { SubmitRegistrationSchema } from '../registrations/registration.schemas';
import { getPublicTournamentInfo, submitRegistration } from '../registrations/registration.service';
import { buildPairingsPdf, type PairingRow } from './pairings-pdf';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUND_RE = /^\d+$/;
const TOKEN_RE = /^[0-9a-f]{64}$/i;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

function parseToken(v: string): string | null {
  return TOKEN_RE.test(v) ? v : null;
}

function handleRegistrationError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof AppError)) throw err;
  const map: Record<string, number> = {
    LINK_NOT_FOUND: 404,
    REGISTRATION_CLOSED: 409,
    INVALID_REGISTRATION: 422,
    ALREADY_PLAYER: 409,
    ALREADY_REGISTERED: 409,
    GUEST_NAME_REQUIRED: 400,
  };
  return reply.code(map[err.code] ?? 500).send({ error: err.code, message: err.message });
}

function parseRoundNumber(v: string): number | null {
  if (!ROUND_RE.test(v)) return null;
  const n = parseInt(v, 10);
  return n >= 1 ? n : null;
}

const PUBLIC_RATE_LIMIT = {
  max: Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 100),
  timeWindow: Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

// Registration submission is a DB write with no auth and no per-guest
// uniqueness constraint — reusing PUBLIC_RATE_LIMIT (built for read-only
// endpoints) would let a single IP flood a tournament's approval queue with
// up to 100 garbage entries/min. Match the stricter tier already used for
// /login and /register instead (auth.routes.ts).
const REGISTRATION_SUBMIT_RATE_LIMIT = {
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
  timeWindow: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

// Short public cache: real-time feel without hammering DB on every auto-refresh tick
const PUBLIC_CACHE = 'public, max-age=15, stale-while-revalidate=30';

interface RoundMeta {
  id: string;
  round_number: number;
  status: string;
  timer_minutes: number;
  started_at: string | null;
}

interface StandingRow {
  rank: number;
  player_id: string;
  display_name: string;
  status: string;
  match_points: number;
  match_wins: number;
  match_losses: number;
  match_draws: number;
  game_wins: number;
  game_losses: number;
  omw_percent: string | null;
  gw_percent: string | null;
  ogw_percent: string | null;
}

async function fetchRound(
  tournamentId: string,
  roundNumber: number,
  requireActive = false,
): Promise<RoundMeta | null> {
  const statusClause = requireActive ? `AND status IN ('active', 'completed')` : '';
  const { rows } = await pool.query<RoundMeta>(
    `SELECT id, round_number, status, timer_minutes, started_at
     FROM rounds WHERE tournament_id = $1 AND round_number = $2 ${statusClause}`,
    [tournamentId, roundNumber],
  );
  return rows[0] ?? null;
}

async function fetchPublishedStandings(
  tournamentId: string,
  roundNumber: number,
): Promise<StandingRow[] | null> {
  const { rows } = await pool.query<StandingRow>(
    `SELECT s.rank, s.player_id, s.match_points,
            s.match_wins, s.match_losses, s.match_draws,
            s.game_wins, s.game_losses,
            s.omw_percent, s.gw_percent, s.ogw_percent,
            COALESCE(u.display_name, tp.guest_name) AS display_name,
            tp.status
     FROM standings s
     JOIN tournament_players tp ON tp.id = s.player_id
     LEFT JOIN users u ON u.id = tp.user_id
     WHERE s.tournament_id = $1 AND s.round_number = $2 AND s.is_published = TRUE
     ORDER BY s.rank`,
    [tournamentId, roundNumber],
  );
  return rows.length === 0 ? null : rows;
}

// Neutralize spreadsheet formula injection: prefix attacker-controlled text cells
// starting with formula trigger characters so Excel/Sheets treat them as literals.
function csvSanitize(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function formatPct(v: string | null): string {
  return v != null ? (Number(v) * 100).toFixed(2) + '%' : '';
}

function buildCsv(standings: StandingRow[]): string {
  const BOM = '﻿'; // UTF-8 BOM — prevents Excel-on-Windows from mangling non-ASCII names
  const header = 'Rank,Player,Match Points,W,L,D,GW,GL,OMW%,GW%,OGW%';
  const lines = standings.map((s) =>
    [
      s.rank,
      `"${csvSanitize(s.display_name).replace(/"/g, '""')}"`,
      s.match_points,
      s.match_wins,
      s.match_losses,
      s.match_draws,
      s.game_wins,
      s.game_losses,
      formatPct(s.omw_percent),
      formatPct(s.gw_percent),
      formatPct(s.ogw_percent),
    ].join(','),
  );
  return BOM + [header, ...lines].join('\r\n');
}

async function fetchPairings(roundId: string): Promise<PairingRow[]> {
  const { rows } = await pool.query<PairingRow>(
    `SELECT p.id, p.table_number, p.is_bye,
            p.player1_id,
            COALESCE(u1.display_name, tp1.guest_name) AS player1_name,
            p.player2_id,
            COALESCE(u2.display_name, tp2.guest_name) AS player2_name
     FROM pairings p
     JOIN tournament_players tp1 ON tp1.id = p.player1_id
     LEFT JOIN users u1 ON u1.id = tp1.user_id
     LEFT JOIN tournament_players tp2 ON tp2.id = p.player2_id
     LEFT JOIN users u2 ON u2.id = tp2.user_id
     WHERE p.round_id = $1
     ORDER BY p.table_number`,
    [roundId],
  );
  return rows;
}

interface TournamentMeta {
  id: string;
  name: string;
  format: string;
  rel_level: string;
  venue: string | null;
  scheduled_at: string | null;
  status: string;
  total_rounds: number;
  top_cut: number;
}

interface RoundRow {
  round_number: number;
  phase: string;
  status: string;
  timer_minutes: number;
  started_at: string | null;
  ended_at: string | null;
}

interface ExportPairingRow {
  round_number: number;
  id: string;
  table_number: number;
  is_bye: boolean;
  player1_id: string;
  player1_name: string;
  player2_id: string | null;
  player2_name: string | null;
}

interface ExportResultRow {
  pairing_id: string;
  player1_game_wins: number;
  player2_game_wins: number;
  games_drawn: number;
  outcome: string;
  entered_at: string;
}

interface ExportStandingRow extends StandingRow {
  round_number: number;
}

// Full tournament dump (all rounds, pairings, results, standings). Reuses the
// same visibility rules as the individual per-round endpoints above — a round's
// pairings only appear once active/completed, standings only once published —
// so this route can never surface more than what's already independently
// reachable one round at a time.
async function fetchTournamentExport(id: string) {
  const { rows: tRows } = await pool.query<TournamentMeta>(
    `SELECT id, name, format, rel_level, venue, scheduled_at, status, total_rounds, top_cut
     FROM tournaments WHERE id = $1 AND status NOT IN ('draft', 'registration')`,
    [id],
  );
  const tournament = tRows[0];
  if (!tournament) return null;

  const { rows: rounds } = await pool.query<RoundRow>(
    `SELECT round_number, phase, status, timer_minutes, started_at, ended_at
     FROM rounds WHERE tournament_id = $1 AND status IN ('active', 'completed')
     ORDER BY round_number`,
    [id],
  );

  const { rows: pairings } = await pool.query<ExportPairingRow>(
    `SELECT r.round_number, p.id, p.table_number, p.is_bye,
            p.player1_id,
            COALESCE(u1.display_name, tp1.guest_name) AS player1_name,
            p.player2_id,
            COALESCE(u2.display_name, tp2.guest_name) AS player2_name
     FROM pairings p
     JOIN rounds r ON r.id = p.round_id
     JOIN tournament_players tp1 ON tp1.id = p.player1_id
     LEFT JOIN users u1 ON u1.id = tp1.user_id
     LEFT JOIN tournament_players tp2 ON tp2.id = p.player2_id
     LEFT JOIN users u2 ON u2.id = tp2.user_id
     WHERE r.tournament_id = $1 AND r.status IN ('active', 'completed')
     ORDER BY r.round_number, p.table_number`,
    [id],
  );

  const { rows: results } = await pool.query<ExportResultRow>(
    `SELECT res.pairing_id, res.player1_game_wins, res.player2_game_wins,
            res.games_drawn, res.outcome, res.entered_at
     FROM results res
     JOIN pairings p ON p.id = res.pairing_id
     JOIN rounds r ON r.id = p.round_id
     WHERE r.tournament_id = $1 AND r.status IN ('active', 'completed')`,
    [id],
  );
  const resultsByPairing = new Map(
    results.map(({ pairing_id, ...rest }) => [pairing_id, rest]),
  );

  const { rows: standings } = await pool.query<ExportStandingRow>(
    `SELECT s.round_number, s.rank, s.player_id, s.match_points,
            s.match_wins, s.match_losses, s.match_draws,
            s.game_wins, s.game_losses, s.omw_percent, s.gw_percent, s.ogw_percent,
            COALESCE(u.display_name, tp.guest_name) AS display_name,
            tp.status
     FROM standings s
     JOIN tournament_players tp ON tp.id = s.player_id
     LEFT JOIN users u ON u.id = tp.user_id
     WHERE s.tournament_id = $1 AND s.is_published = TRUE
     ORDER BY s.round_number, s.rank`,
    [id],
  );

  return {
    tournament,
    rounds: rounds.map((round) => ({
      round_number: round.round_number,
      phase: round.phase,
      status: round.status,
      timer_minutes: round.timer_minutes,
      started_at: round.started_at,
      ended_at: round.ended_at,
      pairings: pairings
        .filter((p) => p.round_number === round.round_number)
        .map(({ round_number: _round_number, ...p }) => ({
          ...p,
          result: resultsByPairing.get(p.id) ?? null,
        })),
      standings: standings
        .filter((s) => s.round_number === round.round_number)
        .map(({ round_number: _round_number, ...s }) => s),
    })),
  };
}

type Params = { id: string; roundNumber: string };

const publicRoutes: FastifyPluginAsync = async (fastify) => {
  // Published standings (JSON) — no auth; only visible after TO publishes each round
  fastify.get<{ Params: Params }>(
    '/tournaments/:id/rounds/:roundNumber/standings',
    {
      config: { rateLimit: PUBLIC_RATE_LIMIT },
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const rn = parseRoundNumber(request.params.roundNumber);
        if (!id || rn === null) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }

        const round = await fetchRound(id, rn, true); // requireActive: pending rounds are not public — consistent with pairings/PDF, see fetchRound's own comment
        if (!round) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Round not found' });
        }

        const standings = await fetchPublishedStandings(id, rn);
        if (!standings) {
          return reply.code(404).send({ error: 'NOT_PUBLISHED', message: 'Standings have not been published for this round' });
        }

        return reply.header('Cache-Control', PUBLIC_CACHE).send({ round, standings });
      },
    },
  );

  // Published standings (CSV download) — no auth
  fastify.get<{ Params: Params }>(
    '/tournaments/:id/rounds/:roundNumber/standings/csv',
    {
      config: { rateLimit: PUBLIC_RATE_LIMIT },
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const rn = parseRoundNumber(request.params.roundNumber);
        if (!id || rn === null) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }

        const round = await fetchRound(id, rn, true); // requireActive: pending rounds are not public — consistent with pairings/PDF, see fetchRound's own comment
        if (!round) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Round not found' });
        }

        const standings = await fetchPublishedStandings(id, rn);
        if (!standings) {
          return reply.code(404).send({ error: 'NOT_PUBLISHED', message: 'Standings have not been published for this round' });
        }

        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="standings-round-${rn}.csv"`)
          .header('Cache-Control', PUBLIC_CACHE)
          .send(buildCsv(standings));
      },
    },
  );

  // Public pairings — no auth; only visible once a round is active or completed
  fastify.get<{ Params: Params }>(
    '/tournaments/:id/rounds/:roundNumber/pairings',
    {
      config: { rateLimit: PUBLIC_RATE_LIMIT },
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const rn = parseRoundNumber(request.params.roundNumber);
        if (!id || rn === null) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }

        const round = await fetchRound(id, rn, true); // requireActive: pending rounds are not public
        if (!round) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Round not found' });
        }

        const rows = await fetchPairings(round.id);

        return reply.header('Cache-Control', PUBLIC_CACHE).send({ round, pairings: rows });
      },
    },
  );

  // Public pairings (PDF download) — no auth; only visible once a round is active or completed
  fastify.get<{ Params: Params }>(
    '/tournaments/:id/rounds/:roundNumber/pairings/pdf',
    {
      config: { rateLimit: PUBLIC_RATE_LIMIT },
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        const rn = parseRoundNumber(request.params.roundNumber);
        if (!id || rn === null) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }

        const round = await fetchRound(id, rn, true); // requireActive: pending rounds are not public
        if (!round) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Round not found' });
        }

        const rows = await fetchPairings(round.id);
        const pdf = await buildPairingsPdf(round, rows);

        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="pairings-round-${rn}.pdf"`)
          .header('Cache-Control', PUBLIC_CACHE)
          .send(pdf);
      },
    },
  );

  // Full tournament export (JSON) — no auth. Whole-tournament dump for
  // compliance/record-keeping; every round applies the same visibility rules
  // as the single-round endpoints above.
  fastify.get<{ Params: { id: string } }>(
    '/tournaments/:id/export/json',
    {
      config: { rateLimit: PUBLIC_RATE_LIMIT },
      handler: async (request, reply) => {
        const id = parseUUID(request.params.id);
        if (!id) {
          return reply.code(400).send({ error: 'INVALID_PARAMS' });
        }

        const data = await fetchTournamentExport(id);
        if (!data) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Tournament not found' });
        }

        return reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="tournament-${id}.json"`)
          .header('Cache-Control', PUBLIC_CACHE)
          .send(data);
      },
    },
  );

  // Registration form info — no auth. Returns tournament basics regardless of
  // status so the client can render a "registration closed" state.
  fastify.get<{ Params: { token: string } }>('/register/:token', {
    config: { rateLimit: PUBLIC_RATE_LIMIT },
    handler: async (request, reply) => {
      const token = parseToken(request.params.token);
      if (!token) return reply.code(400).send({ error: 'INVALID_TOKEN' });

      try {
        return reply.send(await getPublicTournamentInfo(token));
      } catch (err) {
        return handleRegistrationError(err, reply);
      }
    },
  });

  // Self-registration submission. optionalAuthenticate populates request.user
  // when a valid session cookie is present but never rejects the request —
  // logged-in callers register as themselves, anonymous callers as a guest.
  fastify.post<{ Params: { token: string }; Body: unknown }>('/register/:token', {
    config: { rateLimit: REGISTRATION_SUBMIT_RATE_LIMIT },
    preHandler: [optionalAuthenticate, fastify.csrfProtection],
    handler: async (request, reply) => {
      const token = parseToken(request.params.token);
      if (!token) return reply.code(400).send({ error: 'INVALID_TOKEN' });

      const parsed = SubmitRegistrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const actor = request.user ? { userId: request.user.id } : null;
      try {
        const registration = await submitRegistration(token, actor, parsed.data);

        // Only the authenticated-submitter path has a users.id to attribute
        // the write to — audit_log.actor_id is NOT NULL, so a guest
        // submission (no account) structurally can't get an entry here.
        if (actor) {
          try {
            await writeAuditLog({
              tournamentId: registration.tournament_id,
              actorId: actor.userId,
              action: 'registration.submitted',
              entityType: 'tournament_registration',
              entityId: registration.id,
              detail: { user_id: registration.user_id },
            });
          } catch (err) {
            request.log.error({ err }, 'Failed to write audit log — mutation was committed');
          }
        }

        return reply.code(201).send(registration);
      } catch (err) {
        return handleRegistrationError(err, reply);
      }
    },
  });
};

export default publicRoutes;
