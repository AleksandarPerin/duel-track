import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool';
import { joinTournamentRoom, leaveTournamentRoom } from './broadcaster';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUUID(v: string): string | null {
  return UUID_RE.test(v) ? v : null;
}

const PUBLIC_RATE_LIMIT = {
  max: Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 100),
  timeWindow: Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60_000),
};

// Detects dead connections (e.g. a dropped network path never sends a close
// frame) so they don't sit in a room's socket set forever.
const HEARTBEAT_INTERVAL_MS = 30_000;

const wsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    '/tournaments/:id/ws',
    { websocket: true, config: { rateLimit: PUBLIC_RATE_LIMIT } },
    async (socket, request) => {
      const id = parseUUID(request.params.id);
      if (!id) {
        socket.close(1008, 'INVALID_ID');
        return;
      }

      // Same visibility rule the REST public routes enforce (fetchRound's
      // requireActive gate in public.routes.ts): a tournament that hasn't
      // started yet has nothing public to show, so join it to "not found"
      // rather than letting this socket double as an existence oracle for
      // draft/registration tournaments the organizer hasn't launched yet.
      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM tournaments WHERE id = $1',
        [id],
      );
      if (rows.length === 0 || rows[0]!.status === 'draft' || rows[0]!.status === 'registration') {
        socket.close(1008, 'NOT_FOUND');
        return;
      }

      joinTournamentRoom(id, socket);

      let alive = true;
      socket.on('pong', () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, HEARTBEAT_INTERVAL_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        leaveTournamentRoom(id, socket);
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
};

export default wsRoutes;
