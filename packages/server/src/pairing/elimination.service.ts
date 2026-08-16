import type { PoolClient } from 'pg';
import { AppError } from '../errors/AppError';
import type { Round, Pairing } from '@dueltrack/shared';
import type { AdvanceRoundResult } from './pairing.service';

const LIMITED_FORMATS = new Set(['draft', 'sealed']);

function timerFor(format: string): number {
  return LIMITED_FORMATS.has(format) ? 60 : 50;
}

// Returns the smallest power of 2 >= n (minimum 2).
function ceilPow2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
}

async function insertRound(
  client: PoolClient,
  tournamentId: string,
  roundNumber: number,
  timerMinutes: number,
): Promise<Round> {
  const { rows } = await client.query<Round>(
    `INSERT INTO rounds (tournament_id, round_number, phase, status, timer_minutes, started_at)
     VALUES ($1, $2, 'elimination', 'active', $3, NOW())
     RETURNING id, tournament_id, round_number, phase, status, timer_minutes, started_at, ended_at`,
    [tournamentId, roundNumber, timerMinutes],
  );
  return rows[0]!;
}

async function insertPairing(
  client: PoolClient,
  roundId: string,
  tableNumber: number,
  player1Id: string,
  player2Id: string | null,
): Promise<Pairing> {
  const { rows } = await client.query<Pairing>(
    `INSERT INTO pairings (round_id, table_number, player1_id, player2_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, round_id, table_number, player1_id, player2_id, is_bye, override_note`,
    [roundId, tableNumber, player1Id, player2Id],
  );
  return rows[0]!;
}

// Generate first elimination round seeded by final Swiss standings (PAR-10).
// Seeding: Seed 1 vs Seed N, Seed 2 vs Seed N-1, …
// If fewer active players qualified than topCut, top seeds receive byes to fill
// the next power-of-2 bracket size.
export async function generateEliminationRound1(
  client: PoolClient,
  tournamentId: string,
  finalSwissRound: number,
  topCut: number,
  format: string,
  nextRoundNumber: number,
): Promise<AdvanceRoundResult> {
  // C2 fix: only active players can enter the elimination bracket.
  // Dropped players may hold ranks ≤ topCut if enough players dropped mid-Swiss.
  const { rows: seeded } = await client.query<{ player_id: string }>(
    `SELECT s.player_id FROM standings s
     JOIN tournament_players tp ON tp.id = s.player_id AND tp.status = 'active'
     WHERE s.tournament_id = $1 AND s.round_number = $2 AND s.rank <= $3
     ORDER BY s.rank`,
    [tournamentId, finalSwissRound, topCut],
  );

  // C3 fix: be explicit about under-sized cuts (proceed with available actives,
  // minimum 2; byes fill the bracket to the next power of 2).
  if (seeded.length < 2) {
    throw new AppError(
      'INSUFFICIENT_PLAYERS_FOR_CUT',
      `Need at least 2 active players for elimination; only ${seeded.length} qualify`,
    );
  }

  const bracketSize = ceilPow2(seeded.length);
  const byeCount = bracketSize - seeded.length;
  const timer = timerFor(format);

  await client.query(
    `UPDATE tournaments SET status = 'top_cut', current_round = $2 WHERE id = $1`,
    [tournamentId, nextRoundNumber],
  );

  const round = await insertRound(client, tournamentId, nextRoundNumber, timer);
  const pairings: Pairing[] = [];
  let table = 1;

  // Highest seeds get first-round byes
  for (let i = 0; i < byeCount; i++) {
    pairings.push(await insertPairing(client, round.id, table++, seeded[i].player_id, null));
  }

  // Pair remaining: 1vN, 2v(N-1), …
  const playing = seeded.slice(byeCount);
  const N = playing.length;
  for (let i = 0; i < N / 2; i++) {
    pairings.push(
      await insertPairing(client, round.id, table++, playing[i].player_id, playing[N - 1 - i].player_id),
    );
  }

  return { completed: false, round, pairings };
}

// Close the current elimination round and either complete the tournament (1 winner)
// or generate the next elimination round (winners re-seeded by original Swiss rank).
export async function advanceEliminationRound(
  client: PoolClient,
  tournamentId: string,
  activeRoundId: string,
  currentRoundNumber: number,
  format: string,
  finalSwissRound: number,
): Promise<AdvanceRoundResult> {
  // M1 fix: verify all non-bye pairings have results before closing the round.
  // advanceRound checks upstream but this guards direct/test calls too.
  const { rows: missing } = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM pairings p
     LEFT JOIN results r ON r.pairing_id = p.id
     WHERE p.round_id = $1 AND p.is_bye = FALSE AND r.id IS NULL`,
    [activeRoundId],
  );
  if (Number(missing[0]!.count) > 0) {
    throw new AppError('RESULTS_INCOMPLETE', `${missing[0]!.count} elimination match(es) still need results`);
  }

  await client.query(
    `UPDATE rounds SET status = 'completed', ended_at = NOW() WHERE id = $1`,
    [activeRoundId],
  );

  // Determine winners from decisive results (INNER JOIN is safe after the above check)
  const { rows: resultRows } = await client.query<{
    player1_id: string;
    player2_id: string;
    outcome: string;
  }>(
    `SELECT p.player1_id, p.player2_id, r.outcome
     FROM pairings p
     JOIN results r ON r.pairing_id = p.id
     WHERE p.round_id = $1 AND p.is_bye = FALSE`,
    [activeRoundId],
  );

  const winners: string[] = [];
  for (const pr of resultRows) {
    if (pr.outcome === 'player1_win') {
      winners.push(pr.player1_id);
    } else if (pr.outcome === 'player2_win') {
      winners.push(pr.player2_id);
    } else {
      throw new AppError(
        'INVALID_ELIMINATION_RESULT',
        `Outcome "${pr.outcome}" is not valid in elimination; a decisive match win is required`,
      );
    }
  }

  // Bye players advance automatically
  const { rows: byeRows } = await client.query<{ player1_id: string }>(
    `SELECT player1_id FROM pairings WHERE round_id = $1 AND is_bye = TRUE`,
    [activeRoundId],
  );
  for (const b of byeRows) winners.push(b.player1_id);

  if (winners.length === 1) {
    await client.query(`UPDATE tournaments SET status = 'completed' WHERE id = $1`, [tournamentId]);
    return { completed: true, roundNumber: currentRoundNumber };
  }

  // H2 fix: winner count must be even to pair the next round.
  // With well-formed brackets (power-of-2 sizes) this is always true, but guard
  // explicitly in case of data anomalies.
  if (winners.length % 2 !== 0) {
    throw new AppError(
      'ELIMINATION_BRACKET_CORRUPT',
      `Winner count (${winners.length}) is odd — cannot generate next elimination round`,
    );
  }

  // Re-order winners by original Swiss seed (lowest rank = best seed)
  const { rows: seedRows } = await client.query<{ player_id: string; rank: number }>(
    `SELECT player_id, rank FROM standings
     WHERE tournament_id = $1 AND round_number = $2`,
    [tournamentId, finalSwissRound],
  );
  const swissRank = new Map(seedRows.map((r) => [r.player_id, r.rank]));
  const sorted = [...winners].sort((a, b) => (swissRank.get(a) ?? 999) - (swissRank.get(b) ?? 999));
  const N = sorted.length;
  const nextRoundNumber = currentRoundNumber + 1;

  await client.query(
    `UPDATE tournaments SET current_round = $2 WHERE id = $1`,
    [tournamentId, nextRoundNumber],
  );

  const round = await insertRound(client, tournamentId, nextRoundNumber, timerFor(format));
  const pairings: Pairing[] = [];
  for (let i = 0; i < N / 2; i++) {
    pairings.push(await insertPairing(client, round.id, i + 1, sorted[i], sorted[N - 1 - i]));
  }

  return { completed: false, round, pairings };
}
