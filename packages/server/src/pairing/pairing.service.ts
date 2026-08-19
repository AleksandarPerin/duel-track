import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { generatePairings, assignTables } from './engine';
import type { PlayerRecord, PriorMatch } from './types';
import type { Round, Pairing } from '@dueltrack/shared';
import { loadMatchRecords, loadAllPlayers, writeStandings } from '../standings/standings.service';
import { generateEliminationRound1, advanceEliminationRound } from './elimination.service';

const MIN_PLAYERS = 8;
const LIMITED_FORMATS = new Set(['draft', 'sealed']);

async function loadPlayerRecords(
  tournamentId: string,
  roundNumber: number,
  client: PoolClient,
): Promise<PlayerRecord[]> {
  if (roundNumber === 1) {
    const { rows } = await client.query<{
      id: string;
      sort_seed: string;
      byes_received: string;
    }>(
      `SELECT id, sort_seed, byes_received
       FROM tournament_players
       WHERE tournament_id = $1 AND status = 'active'
       ORDER BY sort_seed`,
      [tournamentId],
    );
    return rows.map((r) => ({
      id: r.id,
      sort_seed: Number(r.sort_seed),
      byes_received: Number(r.byes_received),
      match_points: 0,
      omw_pct: 0,
      gw_pct: 0,
    }));
  }

  const { rows } = await client.query<{
    id: string;
    sort_seed: string;
    byes_received: string;
    match_points: string;
    omw_pct: string;
    gw_pct: string;
  }>(
    `SELECT tp.id, tp.sort_seed, tp.byes_received,
            COALESCE(s.match_points, 0)  AS match_points,
            COALESCE(s.omw_percent, 0)   AS omw_pct,
            COALESCE(s.gw_percent, 0)    AS gw_pct
     FROM tournament_players tp
     LEFT JOIN standings s
       ON s.player_id = tp.id AND s.round_number = $2 AND s.tournament_id = $1
     WHERE tp.tournament_id = $1 AND tp.status = 'active'
     ORDER BY tp.sort_seed`,
    [tournamentId, roundNumber - 1],
  );
  return rows.map((r) => ({
    id: r.id,
    sort_seed: Number(r.sort_seed),
    byes_received: Number(r.byes_received),
    match_points: Number(r.match_points),
    omw_pct: Number(r.omw_pct),
    gw_pct: Number(r.gw_pct),
  }));
}

async function loadPriorMatches(
  tournamentId: string,
  client: PoolClient,
): Promise<PriorMatch[]> {
  const { rows } = await client.query<PriorMatch>(
    `SELECT p.player1_id, p.player2_id
     FROM pairings p
     JOIN rounds r ON r.id = p.round_id
     WHERE r.tournament_id = $1 AND p.player2_id IS NOT NULL`,
    [tournamentId],
  );
  return rows;
}

export interface StartRoundResult {
  round: Round;
  pairings: Pairing[];
  warning?: string;
}

export async function startTournament(
  tournamentId: string,
  organizerId: string,
): Promise<StartRoundResult> {
  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');

    const { rows: tRows } = await client.query<{
      id: string;
      organizer_id: string;
      status: string;
      format: string;
    }>(
      `SELECT id, organizer_id, status, format
       FROM tournaments WHERE id = $1 FOR UPDATE`,
      [tournamentId],
    );
    const t = tRows[0];
    if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    if (t.organizer_id !== organizerId) {
      throw new AppError('FORBIDDEN', 'Only the organizer can start the tournament');
    }
    if (t.status !== 'draft' && t.status !== 'registration') {
      throw new AppError(
        'TOURNAMENT_NOT_STARTABLE',
        `Tournament cannot be started from status "${t.status}"`,
      );
    }

    const players = await loadPlayerRecords(tournamentId, 1, client);
    if (players.length < MIN_PLAYERS) {
      throw new AppError(
        'INSUFFICIENT_PLAYERS',
        `At least ${MIN_PLAYERS} active players are required to start`,
      );
    }

    const result = generatePairings(players, []);
    const tableAssignments = assignTables(result.matches, players);

    await client.query(
      `UPDATE tournaments SET status = 'in_progress', current_round = 1 WHERE id = $1`,
      [tournamentId],
    );

    const timerMinutes = LIMITED_FORMATS.has(t.format) ? 60 : 50;
    const { rows: rRows } = await client.query<Round>(
      `INSERT INTO rounds (tournament_id, round_number, phase, status, timer_minutes, started_at)
       VALUES ($1, 1, 'swiss', 'active', $2, NOW())
       RETURNING id, tournament_id, round_number, phase, status, timer_minutes, started_at, ended_at`,
      [tournamentId, timerMinutes],
    );
    const round = rRows[0]!;

    const pairings: Pairing[] = [];
    for (const { table_number, player1_id, player2_id } of tableAssignments) {
      const { rows: pRows } = await client.query<Pairing>(
        `INSERT INTO pairings (round_id, table_number, player1_id, player2_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, round_id, table_number, player1_id, player2_id, is_bye, override_note`,
        [round.id, table_number, player1_id, player2_id],
      );
      pairings.push(pRows[0]!);
    }

    if (result.bye_player_id) {
      const byeTable = tableAssignments.length + 1;
      const { rows: bRows } = await client.query<Pairing>(
        `INSERT INTO pairings (round_id, table_number, player1_id, player2_id)
         VALUES ($1, $2, $3, NULL)
         RETURNING id, round_id, table_number, player1_id, player2_id, is_bye, override_note`,
        [round.id, byeTable, result.bye_player_id],
      );
      pairings.push(bRows[0]!);

      await client.query(
        `UPDATE tournament_players SET byes_received = byes_received + 1 WHERE id = $1`,
        [result.bye_player_id],
      );
    }

    await client.query('COMMIT');
    return { round, pairings, warning: result.warning };
  } catch (err) {
    originalError = err;
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      console.error('ROLLBACK failed in startTournament', e);
    }
    throw originalError;
  } finally {
    client.release();
  }
}

export type AdvanceRoundResult =
  | { completed: true; roundNumber: number }
  | { completed: false; round: Round; pairings: Pairing[]; warning?: string };

// Shared inner logic: close Swiss round → standings → generate next Swiss round or transition to top cut / complete.
// Caller is responsible for BEGIN/COMMIT/ROLLBACK; this function does NOT commit.
async function closeRoundAndContinue(
  client: PoolClient,
  tournamentId: string,
  activeRoundId: string,
  currentRound: number,
  totalRounds: number,
  format: string,
  topCut: number,
): Promise<AdvanceRoundResult> {
  await client.query(
    `UPDATE rounds SET status = 'completed', ended_at = NOW() WHERE id = $1`,
    [activeRoundId],
  );

  // Re-verify after close: defends against results that committed after our pre-close check.
  const { rows: recheck } = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM pairings p
     LEFT JOIN results res ON res.pairing_id = p.id
     WHERE p.round_id = $1 AND p.is_bye = FALSE AND res.id IS NULL`,
    [activeRoundId],
  );
  if (Number(recheck[0]!.count) > 0) {
    throw new AppError('RESULTS_INCOMPLETE', `${recheck[0]!.count} pairing(s) missing results`);
  }

  const allPlayers = await loadAllPlayers(tournamentId, client);
  const records = await loadMatchRecords(tournamentId, currentRound, client);
  await writeStandings(tournamentId, currentRound, allPlayers, records, client);

  if (currentRound >= totalRounds) {
    if (topCut > 0) {
      // Transition to single-elimination bracket seeded by final Swiss standings (PAR-10)
      return generateEliminationRound1(client, tournamentId, currentRound, topCut, format, currentRound + 1);
    }
    await client.query(`UPDATE tournaments SET status = 'completed' WHERE id = $1`, [tournamentId]);
    return { completed: true, roundNumber: currentRound };
  }

  const nextRound = currentRound + 1;
  await client.query(
    `UPDATE tournaments SET current_round = $2 WHERE id = $1`,
    [tournamentId, nextRound],
  );

  const players = await loadPlayerRecords(tournamentId, nextRound, client);
  const priorMatches = await loadPriorMatches(tournamentId, client);
  const pairingResult = generatePairings(players, priorMatches);
  const tableAssignments = assignTables(pairingResult.matches, players);

  const timerMinutes = LIMITED_FORMATS.has(format) ? 60 : 50;
  const { rows: newRoundRows } = await client.query<Round>(
    `INSERT INTO rounds (tournament_id, round_number, phase, status, timer_minutes, started_at)
     VALUES ($1, $2, 'swiss', 'active', $3, NOW())
     RETURNING id, tournament_id, round_number, phase, status, timer_minutes, started_at, ended_at`,
    [tournamentId, nextRound, timerMinutes],
  );
  const newRound = newRoundRows[0]!;

  const pairings: Pairing[] = [];
  for (const { table_number, player1_id, player2_id } of tableAssignments) {
    const { rows: pRows } = await client.query<Pairing>(
      `INSERT INTO pairings (round_id, table_number, player1_id, player2_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, round_id, table_number, player1_id, player2_id, is_bye, override_note`,
      [newRound.id, table_number, player1_id, player2_id],
    );
    pairings.push(pRows[0]!);
  }

  if (pairingResult.bye_player_id) {
    const byeTable = tableAssignments.length + 1;
    const { rows: bRows } = await client.query<Pairing>(
      `INSERT INTO pairings (round_id, table_number, player1_id, player2_id)
       VALUES ($1, $2, $3, NULL)
       RETURNING id, round_id, table_number, player1_id, player2_id, is_bye, override_note`,
      [newRound.id, byeTable, pairingResult.bye_player_id],
    );
    pairings.push(bRows[0]!);
    await client.query(
      `UPDATE tournament_players SET byes_received = byes_received + 1 WHERE id = $1`,
      [pairingResult.bye_player_id],
    );
  }

  return { completed: false, round: newRound, pairings, warning: pairingResult.warning };
}

async function lockTournamentAndRound(
  client: PoolClient,
  tournamentId: string,
  organizerId: string,
): Promise<{
  currentRound: number;
  totalRounds: number;
  format: string;
  activeRoundId: string;
  topCut: number;
  activeRoundPhase: string;
}> {
  const { rows: tRows } = await client.query<{
    organizer_id: string; status: string; format: string;
    total_rounds: string; current_round: string; top_cut: string;
  }>(
    `SELECT organizer_id, status, format, total_rounds, current_round, top_cut
     FROM tournaments WHERE id = $1 FOR UPDATE`,
    [tournamentId],
  );
  const t = tRows[0];
  if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
  if (t.organizer_id !== organizerId) throw new AppError('FORBIDDEN', 'Only the organizer can advance the round');
  if (t.status !== 'in_progress' && t.status !== 'top_cut') {
    throw new AppError('TOURNAMENT_NOT_IN_PROGRESS', 'Tournament is not in progress');
  }

  const currentRound = Number(t.current_round);
  const { rows: rRows } = await client.query<{ id: string; phase: string }>(
    `SELECT id, phase FROM rounds
     WHERE tournament_id = $1 AND round_number = $2 AND status = 'active' FOR UPDATE`,
    [tournamentId, currentRound],
  );
  if (!rRows[0]) throw new AppError('ROUND_NOT_ACTIVE', 'No active round found for this tournament');

  return {
    currentRound,
    totalRounds: Number(t.total_rounds),
    format: t.format,
    activeRoundId: rRows[0].id,
    topCut: Number(t.top_cut),
    activeRoundPhase: rRows[0].phase,
  };
}

export async function advanceRound(
  tournamentId: string,
  organizerId: string,
): Promise<AdvanceRoundResult> {
  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');
    const { currentRound, totalRounds, format, activeRoundId, topCut, activeRoundPhase } =
      await lockTournamentAndRound(client, tournamentId, organizerId);

    const { rows: missing } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pairings p
       LEFT JOIN results res ON res.pairing_id = p.id
       WHERE p.round_id = $1 AND p.is_bye = FALSE AND res.id IS NULL`,
      [activeRoundId],
    );
    if (Number(missing[0]!.count) > 0) {
      throw new AppError('RESULTS_INCOMPLETE', `${missing[0]!.count} pairing(s) still need results`);
    }

    const result = activeRoundPhase === 'elimination'
      ? await advanceEliminationRound(client, tournamentId, activeRoundId, currentRound, format, totalRounds)
      : await closeRoundAndContinue(client, tournamentId, activeRoundId, currentRound, totalRounds, format, topCut);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    originalError = err;
    try { await client.query('ROLLBACK'); } catch (e) { console.error('ROLLBACK failed in advanceRound', e); }
    throw originalError;
  } finally {
    client.release();
  }
}

export async function forceAdvanceRound(
  tournamentId: string,
  organizerId: string,
  responsiblePlayerIds: string[],
): Promise<AdvanceRoundResult & { forced_results: number }> {
  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');
    const { currentRound, totalRounds, format, activeRoundId, topCut, activeRoundPhase } =
      await lockTournamentAndRound(client, tournamentId, organizerId);

    if (activeRoundPhase === 'elimination') {
      throw new AppError('UNSUPPORTED_IN_ELIMINATION', 'Force-advance is not supported during elimination rounds');
    }

    // Fetch incomplete non-bye pairings with player IDs to determine fault
    const { rows: incomplete } = await client.query<{
      id: string;
      player1_id: string;
      player2_id: string;
    }>(
      `SELECT p.id, p.player1_id, p.player2_id FROM pairings p
       LEFT JOIN results res ON res.pairing_id = p.id
       WHERE p.round_id = $1 AND p.is_bye = FALSE AND res.id IS NULL`,
      [activeRoundId],
    );

    // Per PRD TRN-05: if exactly one player in a match is responsible, they receive the
    // 0-2 match loss and their opponent gets a 2-0 win. Both responsible (or neither) → double_loss.
    const responsible = new Set(responsiblePlayerIds);
    let forcedCount = 0;
    for (const p of incomplete) {
      const r1 = responsible.has(p.player1_id);
      const r2 = responsible.has(p.player2_id);
      const outcome = r1 && !r2 ? 'player2_win'
                    : r2 && !r1 ? 'player1_win'
                    : 'double_loss';
      const p1wins = outcome === 'player1_win' ? 2 : 0;
      const p2wins = outcome === 'player2_win' ? 2 : 0;
      const ins = await client.query(
        `INSERT INTO results
           (pairing_id, player1_game_wins, player2_game_wins, games_drawn, outcome, entered_by)
         VALUES ($1, $2, $3, 0, $4, $5)
         ON CONFLICT (pairing_id) DO NOTHING`,
        [p.id, p1wins, p2wins, outcome, organizerId],
      );
      forcedCount += ins.rowCount ?? 0;
    }

    const advResult = await closeRoundAndContinue(client, tournamentId, activeRoundId, currentRound, totalRounds, format, topCut);
    await client.query('COMMIT');
    return { ...advResult, forced_results: forcedCount };
  } catch (err) {
    originalError = err;
    try { await client.query('ROLLBACK'); } catch (e) { console.error('ROLLBACK failed in forceAdvanceRound', e); }
    throw originalError;
  } finally {
    client.release();
  }
}

export async function getRoundPairings(
  tournamentId: string,
  roundNumber: number,
): Promise<{ round: Round; pairings: Pairing[] } | null> {
  const { rows: rRows } = await pool.query<Round>(
    `SELECT id, tournament_id, round_number, phase, status, timer_minutes, started_at, ended_at
     FROM rounds WHERE tournament_id = $1 AND round_number = $2`,
    [tournamentId, roundNumber],
  );
  const round = rRows[0];
  if (!round) return null;

  // has_result lets a client (in particular the offline PWA, which otherwise
  // has no way to distinguish "not yet entered" from "entered before this
  // page load") tell the two apart without a second round-trip.
  const { rows: pRows } = await pool.query<Pairing>(
    `SELECT p.id, p.round_id, p.table_number, p.player1_id, p.player2_id, p.is_bye, p.override_note,
            (r.id IS NOT NULL) AS has_result
     FROM pairings p
     LEFT JOIN results r ON r.pairing_id = p.id
     WHERE p.round_id = $1 ORDER BY p.table_number`,
    [round.id],
  );
  return { round, pairings: pRows };
}
