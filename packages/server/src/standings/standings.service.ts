import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import type { Standing } from '@dueltrack/shared';
import { computeStandings } from './standings.engine';
import type { MatchRecord } from './standings.engine';

export interface PlayerInfo {
  id: string;
  is_active: boolean;
}

export async function loadMatchRecords(
  tournamentId: string,
  throughRound: number,
  client: PoolClient,
): Promise<MatchRecord[]> {
  const { rows } = await client.query<{
    round_number: string;
    player1_id: string;
    player2_id: string | null;
    is_bye: boolean;
    player1_game_wins: string;
    player2_game_wins: string;
    games_drawn: string;
    outcome: MatchRecord['outcome'];
  }>(
    `SELECT r.round_number,
            p.player1_id, p.player2_id, p.is_bye,
            COALESCE(res.player1_game_wins, 0) AS player1_game_wins,
            COALESCE(res.player2_game_wins, 0) AS player2_game_wins,
            COALESCE(res.games_drawn, 0)        AS games_drawn,
            res.outcome
     FROM rounds r
     JOIN pairings p ON p.round_id = r.id
     LEFT JOIN results res ON res.pairing_id = p.id
     WHERE r.tournament_id = $1
       AND r.round_number <= $2
     ORDER BY r.round_number`,
    [tournamentId, throughRound],
  );
  return rows.map((row) => ({
    round_number: Number(row.round_number),
    player1_id: row.player1_id,
    player2_id: row.player2_id,
    is_bye: row.is_bye,
    player1_game_wins: Number(row.player1_game_wins),
    player2_game_wins: Number(row.player2_game_wins),
    games_drawn: Number(row.games_drawn),
    outcome: row.outcome,
  }));
}

export async function loadAllPlayers(
  tournamentId: string,
  client: PoolClient,
): Promise<PlayerInfo[]> {
  const { rows } = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM tournament_players WHERE tournament_id = $1`,
    [tournamentId],
  );
  return rows.map((r) => ({ id: r.id, is_active: r.status === 'active' }));
}

export async function writeStandings(
  tournamentId: string,
  roundNumber: number,
  players: PlayerInfo[],
  records: MatchRecord[],
  client: PoolClient,
): Promise<void> {
  const playerIds = players.map((p) => p.id);
  const entries = computeStandings(playerIds, records, roundNumber);
  if (entries.length === 0) return;

  // Active players ranked 1..active_count; dropped players ranked after in their own
  // sorted order. This ensures dropped players never appear above active players.
  const activeSet = new Set(players.filter((p) => p.is_active).map((p) => p.id));
  let nextActive = 1;
  let nextDropped = activeSet.size + 1;
  for (const e of entries) {
    e.rank = activeSet.has(e.player_id) ? nextActive++ : nextDropped++;
  }

  await client.query(
    `INSERT INTO standings
       (tournament_id, round_number, player_id,
        match_points, match_wins, match_losses, match_draws,
        game_wins, game_losses, omw_percent, gw_percent, ogw_percent, rank)
     SELECT $1::uuid, $2::int,
       unnest($3::uuid[]),
       unnest($4::int[]),  unnest($5::int[]),  unnest($6::int[]),  unnest($7::int[]),
       unnest($8::int[]),  unnest($9::int[]),
       unnest($10::numeric[]), unnest($11::numeric[]), unnest($12::numeric[]),
       unnest($13::int[])
     ON CONFLICT (tournament_id, round_number, player_id) DO UPDATE SET
       match_points = EXCLUDED.match_points,
       match_wins   = EXCLUDED.match_wins,
       match_losses = EXCLUDED.match_losses,
       match_draws  = EXCLUDED.match_draws,
       game_wins    = EXCLUDED.game_wins,
       game_losses  = EXCLUDED.game_losses,
       omw_percent  = EXCLUDED.omw_percent,
       gw_percent   = EXCLUDED.gw_percent,
       ogw_percent  = EXCLUDED.ogw_percent,
       rank         = EXCLUDED.rank`,
    [
      tournamentId, roundNumber,
      entries.map((e) => e.player_id),
      entries.map((e) => e.match_points),
      entries.map((e) => e.match_wins),
      entries.map((e) => e.match_losses),
      entries.map((e) => e.match_draws),
      entries.map((e) => e.game_wins),
      entries.map((e) => e.game_losses),
      entries.map((e) => e.omw_percent),
      entries.map((e) => e.gw_percent),
      entries.map((e) => e.ogw_percent),
      entries.map((e) => e.rank),
    ],
  );
}

export async function getRoundStandings(
  tournamentId: string,
  roundNumber: number,
): Promise<Standing[]> {
  const { rows } = await pool.query<Standing>(
    `SELECT id, tournament_id, round_number, player_id,
            match_points, match_wins, match_losses, match_draws,
            game_wins, game_losses,
            omw_percent, gw_percent, ogw_percent, rank, is_published
     FROM standings
     WHERE tournament_id = $1 AND round_number = $2
     ORDER BY rank`,
    [tournamentId, roundNumber],
  );
  return rows;
}

export async function publishRoundStandings(
  tournamentId: string,
  roundNumber: number,
): Promise<void> {
  const result = await pool.query(
    `UPDATE standings SET is_published = TRUE
     WHERE tournament_id = $1 AND round_number = $2`,
    [tournamentId, roundNumber],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError('STANDINGS_NOT_FOUND', 'No standings found for this round');
  }
}
