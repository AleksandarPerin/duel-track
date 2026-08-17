import type WebSocket from 'ws';
import { redis } from '../db/redis';
import { createRedisClient } from '../db/createRedisClient';

// Fan-out is done via Redis pub/sub (not just an in-process Map) so that an
// event published by whichever server instance handled the mutation reaches
// WS clients connected to any other instance — required as soon as this app
// runs behind more than one process.
const CHANNEL = 'tournament-events';

const rooms = new Map<string, Set<WebSocket>>();

// maxRetriesPerRequest: null — a subscriber must never give up and drop the
// SUBSCRIBE command after a few failed attempts (the default, tuned for the
// shared client's short request/response commands); ioredis instead queues
// it and sends it as soon as the connection comes up.
const subscriber = createRedisClient({ maxRetriesPerRequest: null });
subscriber.on('error', (err) => {
  console.error('Tournament events subscriber error', err);
});
// Re-issue the subscription on every (re)connect rather than once at module
// load: if Redis wasn't reachable yet on the first attempt, or the
// connection drops and reconnects later, this is what keeps the process
// actually subscribed instead of sitting on a healthy-looking connection
// that silently stopped receiving events.
subscriber.on('ready', () => {
  subscriber.subscribe(CHANNEL).catch((err) => {
    console.error('Failed to subscribe to tournament events channel', err);
  });
});
subscriber.on('message', (channel, message) => {
  if (channel !== CHANNEL) return;
  let payload: { tournamentId: string; event: unknown };
  try {
    payload = JSON.parse(message);
  } catch {
    return;
  }
  const sockets = rooms.get(payload.tournamentId);
  if (!sockets || sockets.size === 0) return;
  const data = JSON.stringify(payload.event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
});
// lazyConnect: true means nothing above actually opens a connection —
// 'ready' never fires without an explicit connect() (or a command) kicking
// it off first.
subscriber.connect().catch((err) => {
  console.error('Failed to connect tournament events subscriber', err);
});

export function joinTournamentRoom(tournamentId: string, socket: WebSocket): void {
  let sockets = rooms.get(tournamentId);
  if (!sockets) {
    sockets = new Set();
    rooms.set(tournamentId, sockets);
  }
  sockets.add(socket);
}

export function leaveTournamentRoom(tournamentId: string, socket: WebSocket): void {
  const sockets = rooms.get(tournamentId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) rooms.delete(tournamentId);
}

export async function publishTournamentEvent(
  tournamentId: string,
  event: Record<string, unknown>,
): Promise<void> {
  await redis.publish(CHANNEL, JSON.stringify({ tournamentId, event }));
}
