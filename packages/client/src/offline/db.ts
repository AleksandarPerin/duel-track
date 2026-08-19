import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { ResultInput, Standing, TournamentPlayerView } from '@dueltrack/shared';

export type QueuedResultStatus = 'pending' | 'syncing' | 'auth-required' | 'failed' | 'conflict';

export interface QueuedResult {
  id: string; // client-generated uuid
  tournamentId: string;
  pairingId: string;
  body: ResultInput;
  createdAt: number;
  status: QueuedResultStatus;
  failureReason?: string; // set when status is 'failed' or 'conflict'
}

export interface CachedStandings {
  tournamentId: string;
  roundNumber: number;
  data: Standing[];
  fetchedAt: number;
}

export interface CachedPlayers {
  tournamentId: string;
  data: TournamentPlayerView[];
  fetchedAt: number;
}

interface DuelTrackDB extends DBSchema {
  queuedResults: {
    key: string;
    value: QueuedResult;
    indexes: { 'by-status': string };
  };
  cachedStandings: {
    key: string; // `${tournamentId}:${roundNumber}`
    value: CachedStandings;
  };
  cachedPlayers: {
    key: string; // tournamentId
    value: CachedPlayers;
  };
}

let dbPromise: Promise<IDBPDatabase<DuelTrackDB>> | null = null;

// Keys for cachedStandings/cachedPlayers are out-of-line (passed explicitly to
// get/put) rather than derived via keyPath, so the composite string shape
// stays explicit at each call site instead of implicit in the schema.
export function openDb(): Promise<IDBPDatabase<DuelTrackDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DuelTrackDB>('dueltrack', 1, {
      upgrade(db) {
        const queued = db.createObjectStore('queuedResults', { keyPath: 'id' });
        queued.createIndex('by-status', 'status');
        db.createObjectStore('cachedStandings');
        db.createObjectStore('cachedPlayers');
      },
    });
  }
  return dbPromise;
}
