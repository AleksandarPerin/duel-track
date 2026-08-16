import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';

export interface DropPlayerResult {
  player_id: string;
  drop_round: number;
  auto_result: {
    pairing_id: string;
    outcome: string;
    opponent_id: string;
  } | null;
}

export async function dropPlayer(
  tournamentId: string,
  playerId: string,
  organizerId: string,
): Promise<DropPlayerResult> {
  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');

    const { rows: tRows } = await client.query<{
      organizer_id: string;
      status: string;
      current_round: string;
    }>(
      `SELECT organizer_id, status, current_round
       FROM tournaments WHERE id = $1 FOR UPDATE`,
      [tournamentId],
    );
    const t = tRows[0];
    if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    if (t.organizer_id !== organizerId) throw new AppError('FORBIDDEN', 'Only the organizer can drop players');
    if (t.status !== 'in_progress' && t.status !== 'top_cut') {
      throw new AppError('TOURNAMENT_NOT_IN_PROGRESS', 'Tournament is not in progress');
    }

    const { rows: pRows } = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM tournament_players
       WHERE id = $1 AND tournament_id = $2 FOR UPDATE`,
      [playerId, tournamentId],
    );
    const player = pRows[0];
    if (!player) throw new AppError('PLAYER_NOT_FOUND', 'Player not found in this tournament');
    if (player.status !== 'active') throw new AppError('PLAYER_NOT_ACTIVE', 'Player is already dropped or disqualified');

    const currentRound = Number(t.current_round);

    // Find open (no result) non-bye pairing for this player in the active round
    const { rows: openPairings } = await client.query<{
      id: string;
      player1_id: string;
      player2_id: string;
    }>(
      `SELECT p.id, p.player1_id, p.player2_id
       FROM pairings p
       JOIN rounds r ON r.id = p.round_id
       LEFT JOIN results res ON res.pairing_id = p.id
       WHERE r.tournament_id = $1 AND r.round_number = $2 AND r.status = 'active'
         AND p.is_bye = FALSE AND res.id IS NULL
         AND (p.player1_id = $3 OR p.player2_id = $3)
       FOR UPDATE OF p`,
      [tournamentId, currentRound, playerId],
    );

    let autoResult: DropPlayerResult['auto_result'] = null;

    if (openPairings.length > 0) {
      const pairing = openPairings[0]!;
      const droppedIsP1 = pairing.player1_id === playerId;
      const outcome = droppedIsP1 ? 'player2_win' : 'player1_win';
      const opponentId = droppedIsP1 ? pairing.player2_id : pairing.player1_id;

      await client.query(
        `INSERT INTO results
           (pairing_id, player1_game_wins, player2_game_wins, games_drawn, outcome, entered_by)
         VALUES ($1, $2, $3, 0, $4, $5)
         ON CONFLICT (pairing_id) DO NOTHING`,
        [
          pairing.id,
          droppedIsP1 ? 0 : 2,
          droppedIsP1 ? 2 : 0,
          outcome,
          organizerId,
        ],
      );

      autoResult = { pairing_id: pairing.id, outcome, opponent_id: opponentId };
    }

    await client.query(
      `UPDATE tournament_players SET status = 'dropped', drop_round = $2
       WHERE id = $1`,
      [playerId, currentRound],
    );

    await client.query('COMMIT');
    return { player_id: playerId, drop_round: currentRound, auto_result: autoResult };
  } catch (err) {
    originalError = err;
    try { await client.query('ROLLBACK'); } catch (e) { console.error('ROLLBACK failed in dropPlayer', e); }
    throw originalError;
  } finally {
    client.release();
  }
}
