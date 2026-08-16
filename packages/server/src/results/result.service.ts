import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import type { Result, ResultInput } from '@dueltrack/shared';

export async function enterResult(
  tournamentId: string,
  pairingId: string,
  data: ResultInput,
  actorId: string,
): Promise<Result> {
  const client = await pool.connect();
  let originalError: unknown;
  try {
    await client.query('BEGIN');

    // Verify the pairing belongs to the active round of this tournament
    const { rows: pRows } = await client.query<{
      id: string;
      is_bye: boolean;
      round_status: string;
      round_phase: string;
      tournament_id: string;
      tournament_status: string;
      organizer_id: string;
    }>(
      `SELECT p.id, p.is_bye,
              r.status AS round_status,
              r.phase  AS round_phase,
              t.id     AS tournament_id,
              t.status AS tournament_status,
              t.organizer_id
       FROM pairings p
       JOIN rounds r ON r.id = p.round_id
       JOIN tournaments t ON t.id = r.tournament_id
       WHERE p.id = $1 AND t.id = $2 AND r.status = 'active'
       FOR UPDATE OF p, r`,
      [pairingId, tournamentId],
    );
    const pairing = pRows[0];
    if (!pairing) {
      throw new AppError('PAIRING_NOT_FOUND', 'Pairing not found or round is not active');
    }
    // C1: top_cut tournaments are in 'top_cut' status during elimination rounds
    if (pairing.tournament_status !== 'in_progress' && pairing.tournament_status !== 'top_cut') {
      throw new AppError('TOURNAMENT_NOT_IN_PROGRESS', 'Tournament is not in progress');
    }
    // C2: only the organizer may enter results (judge role deferred to Phase 2)
    if (pairing.organizer_id !== actorId) {
      throw new AppError('FORBIDDEN', 'Only the tournament organizer can enter results');
    }
    if (pairing.is_bye) {
      throw new AppError('BYE_RESULT', 'Cannot enter a result for a bye pairing');
    }
    // H2: draws and double-losses are not valid outcomes in elimination rounds
    if (pairing.round_phase === 'elimination') {
      const decisive = data.outcome === 'player1_win' || data.outcome === 'player2_win';
      if (!decisive) {
        throw new AppError(
          'INVALID_ELIMINATION_RESULT',
          'Only player1_win or player2_win are valid outcomes in elimination rounds',
        );
      }
    }

    // INSERT ON CONFLICT handles duplicate detection atomically — no SELECT needed.
    // Locking r above ensures a concurrent advanceRound cannot close the round
    // between the pairing check and this INSERT.
    const { rows: rRows } = await client.query<Result>(
      `INSERT INTO results (pairing_id, player1_game_wins, player2_game_wins, games_drawn, outcome, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pairing_id) DO NOTHING
       RETURNING id, pairing_id, player1_game_wins, player2_game_wins, games_drawn, outcome, entered_by, entered_at`,
      [pairingId, data.player1_game_wins, data.player2_game_wins, data.games_drawn, data.outcome, actorId],
    );
    if (rRows.length === 0) {
      throw new AppError('RESULT_ALREADY_ENTERED', 'A result has already been entered for this pairing');
    }

    await client.query('COMMIT');
    return rRows[0]!;
  } catch (err) {
    originalError = err;
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      console.error('ROLLBACK failed in enterResult', e);
    }
    throw originalError;
  } finally {
    client.release();
  }
}
