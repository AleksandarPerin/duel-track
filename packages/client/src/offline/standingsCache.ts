import type { Standing, TournamentPlayerView } from '@dueltrack/shared';
import { openDb } from './db';

// Pure — informational only (e.g. dim/warn on very old cache). The decision
// to fall back to cache at all is driven by fetch success/failure or
// navigator.onLine in RoundPage, not by staleness.
export function isStale(fetchedAt: number, maxAgeMs = 5 * 60_000): boolean {
  return Date.now() - fetchedAt > maxAgeMs;
}

function standingsKey(tournamentId: string, roundNumber: number): string {
  return `${tournamentId}:${roundNumber}`;
}

export async function getCachedStandings(
  tournamentId: string,
  roundNumber: number,
): Promise<{ data: Standing[]; fetchedAt: number } | null> {
  const db = await openDb();
  const entry = await db.get('cachedStandings', standingsKey(tournamentId, roundNumber));
  return entry ? { data: entry.data, fetchedAt: entry.fetchedAt } : null;
}

export async function setCachedStandings(
  tournamentId: string,
  roundNumber: number,
  data: Standing[],
): Promise<void> {
  const db = await openDb();
  await db.put(
    'cachedStandings',
    { tournamentId, roundNumber, data, fetchedAt: Date.now() },
    standingsKey(tournamentId, roundNumber),
  );
}

export async function getCachedPlayers(
  tournamentId: string,
): Promise<{ data: TournamentPlayerView[]; fetchedAt: number } | null> {
  const db = await openDb();
  const entry = await db.get('cachedPlayers', tournamentId);
  return entry ? { data: entry.data, fetchedAt: entry.fetchedAt } : null;
}

export async function setCachedPlayers(
  tournamentId: string,
  data: TournamentPlayerView[],
): Promise<void> {
  const db = await openDb();
  await db.put('cachedPlayers', { tournamentId, data, fetchedAt: Date.now() }, tournamentId);
}
